import { describe, it, expect, beforeAll, afterAll, beforeEach } from '@jest/globals';
import { createServer } from 'http';
import { Server } from 'socket.io';
import { io as ioc } from 'socket.io-client';
import { MongoMemoryServer } from 'mongodb-memory-server';
import mongoose from 'mongoose';
import jwt from 'jsonwebtoken';
import bcrypt from 'bcryptjs';
import { connectDb, disconnectDb } from '../../src/config/db.js';
import { createApp } from '../../src/app.js';
import { initChatSockets } from '../../src/sockets/chat.js';
import { KnowledgeBaseEntry } from '../../src/models/KnowledgeBaseEntry.js';
import { Conversation } from '../../src/models/Conversation.js';
import { Message } from '../../src/models/Message.js';
import { Admin } from '../../src/models/Admin.js';
import { setLlmOverride, resetLlmOverride } from '../../src/services/llm.js';

/**
 * End-to-end realtime flows: customer ↔ Durra AI ↔ admins over HTTP + Socket.io,
 * the way the website and the admin inbox use them.
 */

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

describe('Realtime chat end to end', () => {
  let httpServer;
  let ioServer;
  let baseUrl;
  let mem;
  const sockets = [];

  /** Socket that records every event it receives. */
  async function client(token) {
    const s = ioc(baseUrl, { transports: ['websocket'], forceNew: true, auth: token ? { token } : undefined });
    s.events = [];
    s.onAny((event, payload) => s.events.push({ event, payload }));
    await new Promise((resolve) => s.once('connect', resolve));
    sockets.push(s);
    return s;
  }
  const emitAck = (s, event, payload) => new Promise((resolve) => s.emit(event, payload, resolve));
  const got = (s, event, pred = () => true) => s.events.filter((e) => e.event === event && pred(e.payload));

  async function admin(name) {
    const a = await Admin.create({ name, email: `${name}@test.com`, passwordHash: await bcrypt.hash('x', 4) });
    const token = jwt.sign({ sub: a._id.toString(), role: 'admin' }, process.env.JWT_SECRET);
    const s = await client(token);
    expect((await emitAck(s, 'join:admin-queue', {})).ok).toBe(true);
    return { id: a._id.toString(), token, s };
  }

  async function http(method, path, body, token) {
    const res = await fetch(`${baseUrl}${path}`, {
      method,
      headers: {
        'Content-Type': 'application/json',
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      body: body ? JSON.stringify(body) : undefined,
    });
    return { status: res.status, body: await res.json().catch(() => null) };
  }

  /** Customer opens a chat the way the website does. */
  async function customer(lang = 'en') {
    const phone = `+9665${String(Date.now()).slice(-8)}`;
    const session = await http('POST', '/chat/session', { name: 'Sara', phone, lang });
    expect(session.status).toBe(201);
    const conversationId = String(session.body.conversationId);
    const s = await client();
    s.emit('join:conversation', { conversationId, phone });
    await sleep(50);
    const send = (body) =>
      http('POST', '/chat/message', { conversationId, lang, ...body });
    return { conversationId, phone, s, send };
  }

  async function escalated(lang) {
    const c = await customer(lang);
    const r = await c.send({ choiceId: 'human' });
    expect(r.body.status).toBe('needs_human');
    return c;
  }

  beforeAll(async () => {
    mem = await MongoMemoryServer.create();
    await connectDb(mem.getUri());
    httpServer = createServer(createApp({ corsOrigin: '*' }));
    ioServer = new Server(httpServer, { cors: { origin: '*' } });
    initChatSockets(ioServer);
    await new Promise((resolve) => httpServer.listen(0, resolve));
    baseUrl = `http://127.0.0.1:${httpServer.address().port}`;
  });

  afterAll(async () => {
    for (const s of sockets) s.close();
    resetLlmOverride();
    ioServer.close();
    httpServer.close();
    await disconnectDb();
    await mem.stop();
  });

  beforeEach(async () => {
    for (const s of sockets.splice(0)) s.close();
    for (const c of Object.values(mongoose.connection.collections)) await c.deleteMany({});
    await KnowledgeBaseEntry.create({ title: 'Do you go to Madinah?', content: 'Yes, daily trips to Madinah.' });
    setLlmOverride(async () => 'Yes, we run daily trips to Madinah.');
  });

  it('FAQ answer: HTTP reply and socket copy share one messageId', async () => {
    const c = await customer();
    const r = await c.send({ text: 'do you go to madinah' });
    expect(r.body.reason).toBe('faq');
    await sleep(50);
    const ai = got(c.s, 'message:new', (p) => p.sender === 'ai');
    expect(ai).toHaveLength(1);
    expect(ai[0].payload.messageId).toBe(r.body.messageId);
  });

  it('escalation: customer gets one notice, admin queue gets the event', async () => {
    const a = await admin('a1');
    const c = await escalated();
    await sleep(50);
    expect(got(c.s, 'message:new', (p) => p.sender === 'system')).toHaveLength(1);
    expect(got(a.s, 'conversation:escalated', (p) => p.conversationId === c.conversationId)).toHaveLength(1);
  });

  it('two admins claim at once: exactly one wins', async () => {
    const [a1, a2] = [await admin('a1'), await admin('a2')];
    const c = await escalated();
    const acks = await Promise.all([
      emitAck(a1.s, 'admin:claim', { conversationId: c.conversationId }),
      emitAck(a2.s, 'admin:claim', { conversationId: c.conversationId }),
    ]);
    expect(acks.filter((x) => x.ok)).toHaveLength(1);
    await sleep(50);
    expect(got(c.s, 'conversation:claimed')).toHaveLength(1);
  });

  it('claimed: live two-way talk, AI stays silent, assigned admin is pinged', async () => {
    const a = await admin('a1');
    const c = await escalated();
    await emitAck(a.s, 'admin:claim', { conversationId: c.conversationId });
    a.s.emit('join:conversation', { conversationId: c.conversationId });
    await sleep(50);

    expect((await emitAck(a.s, 'admin:message', { conversationId: c.conversationId, text: 'Hi, Ahmed here' })).ok).toBe(true);
    const r = await c.send({ text: 'do you go to madinah' });
    expect(r.body.reason).toBe('claimed');
    expect(r.body.answer).toBeNull();
    await sleep(50);

    expect(got(c.s, 'message:new', (p) => p.sender === 'admin' && p.text === 'Hi, Ahmed here')).toHaveLength(1);
    expect(got(a.s, 'message:new', (p) => p.sender === 'customer')).toHaveLength(1);
    expect(got(a.s, 'conversation:customer_message', (p) => p.assignedAdminId === a.id)).toHaveLength(1);
    expect(await Message.countDocuments({ conversationId: c.conversationId, sender: 'ai' })).toBe(0);
  });

  it('admin broadcast carries conversationId (inbox filters by it)', async () => {
    const a = await admin('a1');
    const c = await escalated();
    await emitAck(a.s, 'admin:claim', { conversationId: c.conversationId });
    await emitAck(a.s, 'admin:message', { conversationId: c.conversationId, text: 'hello' });
    await sleep(50);
    const m = got(c.s, 'message:new', (p) => p.sender === 'admin')[0];
    expect(m.payload.conversationId).toBe(c.conversationId);
    expect(m.payload.messageId).toBeTruthy();
  });

  it('only the assigned admin can post into a claimed chat', async () => {
    const [a1, a2] = [await admin('a1'), await admin('a2')];
    const c = await escalated();
    await emitAck(a1.s, 'admin:claim', { conversationId: c.conversationId });
    const ack = await emitAck(a2.s, 'admin:message', { conversationId: c.conversationId, text: 'not mine' });
    expect(ack.ok).toBe(false);
  });

  it('admin cannot post into a chat Durra AI is handling or one nobody claimed', async () => {
    const a = await admin('a1');
    const live = await customer();
    expect((await emitAck(a.s, 'admin:message', { conversationId: live.conversationId, text: 'x' })).ok).toBe(false);
    const waiting = await escalated();
    expect((await emitAck(a.s, 'admin:message', { conversationId: waiting.conversationId, text: 'x' })).ok).toBe(false);
  });

  it('admin close: customer gets a localized notice with messageId and a closed event; next message reopens to Durra AI', async () => {
    const a = await admin('a1');
    const c = await escalated('ar');
    await emitAck(a.s, 'admin:claim', { conversationId: c.conversationId });
    const closed = await http('PATCH', `/conversations/${c.conversationId}`, { status: 'closed' }, a.token);
    expect(closed.status).toBe(200);
    await sleep(50);

    const notice = got(c.s, 'message:new', (p) => p.sender === 'system').at(-1).payload;
    expect(notice.messageId).toBeTruthy();
    expect(notice.text).toMatch(/[؀-ۿ]/);
    expect(got(c.s, 'conversation:closed', (p) => p.conversationId === c.conversationId)).toHaveLength(1);

    const r = await c.send({ text: 'do you go to madinah' });
    expect(r.body.status).toBe('ai_handling');
    expect(r.body.reason).toBe('faq');
    const conv = await Conversation.findById(c.conversationId).lean();
    expect(conv.assignedAdminId).toBeNull();
  });

  it('a stranger who only knows the conversation id cannot listen in or read history', async () => {
    const c = await customer();
    const stranger = await client();
    expect((await emitAck(stranger, 'join:conversation', { conversationId: c.conversationId, phone: '+966500000000' })).ok).toBe(false);
    await c.send({ text: 'do you go to madinah' });
    await sleep(50);
    expect(got(stranger, 'message:new')).toHaveLength(0);

    const hist = await http('GET', `/chat/history?conversationId=${c.conversationId}&phone=%2B966500000000`);
    expect(hist.status).toBe(404);
  });
});
