import { describe, it, expect, beforeAll, afterAll, beforeEach } from '@jest/globals';
import request from 'supertest';
import bcrypt from 'bcryptjs';
import { createApp } from '../../src/app.js';
import { startTestDb, stopTestDb, clearDb } from '../helpers/db.js';
import { Admin } from '../../src/models/Admin.js';
import { Customer } from '../../src/models/Customer.js';
import { Conversation } from '../../src/models/Conversation.js';
import { Message } from '../../src/models/Message.js';

describe('Conversations (admin)', () => {
  let app;
  let token;

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
    await Admin.create({
      name: 'Ops',
      email: 'ops@test.com',
      passwordHash,
      role: 'admin',
    });
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
    const customer = await Customer.create({
      name: 'Sam',
      contact: 'sam@example.com',
    });
    await Conversation.create({
      customerId: customer._id,
      status: 'needs_human',
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

  it('returns message history for a conversation', async () => {
    const customer = await Customer.create({
      name: 'Sam',
      contact: 'sam@example.com',
    });
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
    expect(res.body.conversation.customer.contact).toBe('sam@example.com');
  });
});
