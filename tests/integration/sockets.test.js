import { describe, it, expect, beforeAll, afterAll, beforeEach } from '@jest/globals';
import { createServer } from 'http';
import { Server } from 'socket.io';
import { io as ioc } from 'socket.io-client';
import { MongoMemoryServer } from 'mongodb-memory-server';
import mongoose from 'mongoose';
import jwt from 'jsonwebtoken';
import bcrypt from 'bcryptjs';
import { connectDb, disconnectDb } from '../../src/config/db.js';
import { initChatSockets } from '../../src/sockets/chat.js';
import { KnowledgeBaseEntry } from '../../src/models/KnowledgeBaseEntry.js';
import { Conversation } from '../../src/models/Conversation.js';
import { Customer } from '../../src/models/Customer.js';
import { Admin } from '../../src/models/Admin.js';
import { setEmbedOverride, resetEmbedOverride } from '../../src/services/embedding.js';
import { setLlmOverride, resetLlmOverride } from '../../src/services/llm.js';

function unit(i) {
  const v = Array(384).fill(0);
  v[i % 384] = 1;
  return v;
}

function waitFor(socket, event, timeoutMs = 5000) {
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error(`Timeout waiting for ${event}`)), timeoutMs);
    socket.once(event, (payload) => {
      clearTimeout(t);
      resolve(payload);
    });
  });
}

function tokenFor(adminId) {
  return jwt.sign(
    { sub: adminId.toString(), role: 'admin' },
    process.env.JWT_SECRET || 'test-jwt-secret'
  );
}

describe('Socket.io chat & escalation (Phase 4)', () => {
  let httpServer;
  let ioServer;
  let baseUrl;
  let mem;

  beforeAll(async () => {
    process.env.JWT_SECRET = 'test-jwt-secret';
    process.env.RAG_SIMILARITY_THRESHOLD = '0.5';
    mem = await MongoMemoryServer.create();
    await connectDb(mem.getUri());

    httpServer = createServer();
    ioServer = new Server(httpServer, { cors: { origin: '*' } });
    initChatSockets(ioServer);

    await new Promise((resolve) => {
      httpServer.listen(0, resolve);
    });
    const port = httpServer.address().port;
    baseUrl = `http://127.0.0.1:${port}`;
  });

  afterAll(async () => {
    resetEmbedOverride();
    resetLlmOverride();
    ioServer.close();
    httpServer.close();
    await disconnectDb();
    await mem.stop();
  });

  beforeEach(async () => {
    const collections = mongoose.connection.collections;
    for (const key of Object.keys(collections)) {
      await collections[key].deleteMany({});
    }
    resetEmbedOverride();
    resetLlmOverride();
  });

  it('customer receives AI reply via socket', async () => {
    await KnowledgeBaseEntry.create({
      title: 'Hours',
      content: 'Open 9-5',
      chunks: [{ text: 'We are open 9-5.', embedding: unit(0) }],
    });
    setEmbedOverride(async () => unit(0));
    setLlmOverride(async () => 'We are open 9-5.');

    const client = ioc(baseUrl, { transports: ['websocket'], forceNew: true });
    await waitFor(client, 'connect');

    const replyPromise = waitFor(client, 'message:new');
    client.emit('chat:message', {
      text: 'What are your hours?',
      customerContact: 'socket@test.com',
      customerName: 'Sock',
    });

    const reply = await replyPromise;
    expect(reply.sender).toBe('ai');
    expect(reply.text).toMatch(/9-5/);
    client.close();
  });

  it('escalation reaches an admin socket listener', async () => {
    const admin = await Admin.create({
      name: 'Admin',
      email: 'admin-sock@test.com',
      passwordHash: await bcrypt.hash('x', 4),
    });

    const adminClient = ioc(baseUrl, {
      transports: ['websocket'],
      forceNew: true,
      auth: { token: tokenFor(admin._id) },
    });
    await waitFor(adminClient, 'connect');
    const joinAck = await new Promise((resolve) => {
      adminClient.emit('join:admin-queue', {}, (ack) => resolve(ack));
    });
    expect(joinAck.ok).toBe(true);

    const customer = ioc(baseUrl, { transports: ['websocket'], forceNew: true });
    await waitFor(customer, 'connect');

    const escalatedPromise = waitFor(adminClient, 'conversation:escalated');
    customer.emit('chat:message', {
      text: 'talk to a human',
      customerContact: 'esc@test.com',
    });

    const event = await escalatedPromise;
    expect(event.conversationId).toBeDefined();
    expect(event.reason).toBe('explicit_human_request');

    adminClient.close();
    customer.close();
  });

  it('rejects admin queue join without JWT', async () => {
    const client = ioc(baseUrl, { transports: ['websocket'], forceNew: true });
    await waitFor(client, 'connect');
    const ack = await new Promise((resolve) => {
      client.emit('join:admin-queue', {}, (a) => resolve(a));
    });
    expect(ack.ok).toBe(false);
    client.close();
  });

  it('only one admin wins a simultaneous claim race', async () => {
    const customerDoc = await Customer.create({
      name: 'C',
      contact: 'race@test.com',
    });
    const conversation = await Conversation.create({
      customerId: customerDoc._id,
      status: 'needs_human',
    });

    const a1 = await Admin.create({
      name: 'A1',
      email: 'a1@test.com',
      passwordHash: await bcrypt.hash('x', 4),
    });
    const a2 = await Admin.create({
      name: 'A2',
      email: 'a2@test.com',
      passwordHash: await bcrypt.hash('x', 4),
    });

    const s1 = ioc(baseUrl, {
      transports: ['websocket'],
      forceNew: true,
      auth: { token: tokenFor(a1._id) },
    });
    const s2 = ioc(baseUrl, {
      transports: ['websocket'],
      forceNew: true,
      auth: { token: tokenFor(a2._id) },
    });
    await Promise.all([waitFor(s1, 'connect'), waitFor(s2, 'connect')]);
    await Promise.all([
      new Promise((r) => s1.emit('join:admin-queue', {}, r)),
      new Promise((r) => s2.emit('join:admin-queue', {}, r)),
    ]);

    const claim = (socket) =>
      new Promise((resolve) => {
        socket.emit('admin:claim', { conversationId: conversation._id.toString() }, (ack) =>
          resolve(ack)
        );
      });

    const [r1, r2] = await Promise.all([claim(s1), claim(s2)]);
    const successes = [r1, r2].filter((r) => r.ok);
    const failures = [r1, r2].filter((r) => !r.ok);
    expect(successes).toHaveLength(1);
    expect(failures).toHaveLength(1);

    const refreshed = await Conversation.findById(conversation._id);
    expect(refreshed.status).toBe('claimed');
    expect(refreshed.assignedAdminId).toBeTruthy();

    s1.close();
    s2.close();
  });

  it('reopens a closed conversation on new customer message', async () => {
    const customerDoc = await Customer.create({
      name: 'C',
      contact: 'reopen@test.com',
    });
    const conversation = await Conversation.create({
      customerId: customerDoc._id,
      status: 'closed',
    });

    await KnowledgeBaseEntry.create({
      title: 'Hours',
      content: 'Open 9-5',
      chunks: [{ text: 'Open 9-5', embedding: unit(0) }],
    });
    setEmbedOverride(async () => unit(0));
    setLlmOverride(async () => 'Open 9-5');

    const client = ioc(baseUrl, { transports: ['websocket'], forceNew: true });
    await waitFor(client, 'connect');

    const ack = await new Promise((resolve) => {
      client.emit(
        'chat:message',
        {
          text: 'Hello again',
          conversationId: conversation._id.toString(),
          customerContact: 'reopen@test.com',
        },
        (response) => resolve(response)
      );
    });

    expect(ack.ok).toBe(true);
    expect(ack.status).toBe('ai_handling');
    const refreshed = await Conversation.findById(conversation._id);
    expect(refreshed.status).toBe('ai_handling');
    client.close();
  });
});
