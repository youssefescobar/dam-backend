import { describe, it, expect, beforeAll, afterAll, beforeEach } from '@jest/globals';
import request from 'supertest';
import bcrypt from 'bcryptjs';
import { createApp } from '../../src/app.js';
import { startTestDb, stopTestDb, clearDb } from '../helpers/db.js';
import { Admin } from '../../src/models/Admin.js';
import { Customer } from '../../src/models/Customer.js';
import { Conversation } from '../../src/models/Conversation.js';
import { Message } from '../../src/models/Message.js';

function customerFixture(overrides = {}) {
  return {
    name: 'Sam',
    email: 'sam@example.com',
    phone: '+15555550111',
    contact: '+15555550111',
    ...overrides,
  };
}

describe('Conversations (admin)', () => {
  let app;
  let token;
  let adminId;

  beforeAll(async () => {
    process.env.JWT_SECRET = 'test-jwt-secret-for-jest';
    await startTestDb();
    app = createApp();
  });

  afterAll(async () => {
    await stopTestDb();
  });

  beforeEach(async () => {
    await clearDb();
    const passwordHash = await bcrypt.hash('password123', 10);
    const admin = await Admin.create({
      name: 'Ops',
      email: 'ops@test.com',
      passwordHash,
      role: 'admin',
    });
    adminId = admin._id;
    const login = await request(app)
      .post('/auth/login')
      .send({ email: 'ops@test.com', password: 'password123' });
    token = login.body.token;
  });

  it('rejects without JWT', async () => {
    const res = await request(app).get('/conversations');
    expect(res.status).toBe(401);
  });

  it('lists conversations filtered by status with customer info', async () => {
    const customer = await Customer.create(customerFixture());
    await Conversation.create({
      customerId: customer._id,
      status: 'needs_human',
      lastActivityAt: new Date(Date.now() - 60_000),
    });
    await Conversation.create({
      customerId: customer._id,
      status: 'ai_handling',
    });

    const res = await request(app)
      .get('/conversations?status=needs_human')
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(200);
    expect(res.body.conversations).toHaveLength(1);
    expect(res.body.conversations[0].status).toBe('needs_human');
    expect(res.body.conversations[0].customer.name).toBe('Sam');
  });

  it('lists mine=1 as claimed chats assigned to current admin', async () => {
    const customer = await Customer.create(customerFixture());
    await Conversation.create({
      customerId: customer._id,
      status: 'claimed',
      assignedAdminId: adminId,
    });
    await Conversation.create({
      customerId: customer._id,
      status: 'claimed',
      assignedAdminId: null,
    });

    const res = await request(app)
      .get('/conversations?mine=1')
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(200);
    expect(res.body.conversations).toHaveLength(1);
    expect(String(res.body.conversations[0].assignedAdminId)).toBe(String(adminId));
  });

  it('returns message history for a conversation', async () => {
    const customer = await Customer.create(customerFixture());
    const conversation = await Conversation.create({
      customerId: customer._id,
      status: 'claimed',
    });
    await Message.create({
      conversationId: conversation._id,
      sender: 'customer',
      text: 'Hello',
    });
    await Message.create({
      conversationId: conversation._id,
      sender: 'ai',
      text: 'Hi there',
    });

    const res = await request(app)
      .get(`/conversations/${conversation._id}/messages`)
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(200);
    expect(res.body.messages).toHaveLength(2);
    expect(res.body.conversation.customer.contact).toBe('+15555550111');
  });

  it('deletes a conversation and its messages', async () => {
    const customer = await Customer.create(
      customerFixture({ email: 'del@example.com', phone: '+15555550999', contact: '+15555550999' })
    );
    const conversation = await Conversation.create({
      customerId: customer._id,
      status: 'closed',
    });
    await Message.create({
      conversationId: conversation._id,
      sender: 'customer',
      text: 'Bye',
    });

    const res = await request(app)
      .delete(`/conversations/${conversation._id}`)
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(204);
    expect(await Conversation.findById(conversation._id)).toBeNull();
    expect(await Message.countDocuments({ conversationId: conversation._id })).toBe(0);
  });
});
