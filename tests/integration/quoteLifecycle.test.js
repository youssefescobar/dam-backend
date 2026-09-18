import { describe, it, expect, beforeAll, afterAll, beforeEach } from '@jest/globals';
import request from 'supertest';
import bcrypt from 'bcryptjs';
import { createApp } from '../../src/app.js';
import { startTestDb, stopTestDb, clearDb } from '../helpers/db.js';
import { Admin } from '../../src/models/Admin.js';
import { Message } from '../../src/models/Message.js';
import { Quote } from '../../src/models/Quote.js';
import { setPushImplementation } from '../../src/services/push.js';

describe('Quote lifecycle E2E (Phase 6)', () => {
  let app;
  let token;
  const pushes = [];

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
    pushes.length = 0;

    const passwordHash = await bcrypt.hash('password123', 10);
    await Admin.create({
      name: 'Ops',
      email: 'ops@test.com',
      passwordHash,
      role: 'admin',
      pushSubscriptions: [
        {
          endpoint: 'https://push.example.com/ops',
          keys: { p256dh: 'x', auth: 'y' },
        },
      ],
    });

    const login = await request(app)
      .post('/auth/login')
      .send({ email: 'ops@test.com', password: 'password123' });
    token = login.body.token;

    setPushImplementation(async (payload) => {
      pushes.push(payload);
    });
  });

  it('submit → admin notified → quote priced → customer conversation gets price message', async () => {
    // 1. Customer submits quote
    const created = await request(app).post('/quotes').send({
      customerName: 'Jordan Lee',
      customerContact: 'jordan@example.com',
      pickup: 'JFK Airport',
      dropoff: 'Manhattan Hotel',
      date: '2026-12-15T14:00:00.000Z',
      vehicleType: 'sprinter',
      passengers: 8,
      notes: 'Flight AA100',
    });
    expect(created.status).toBe(201);
    const quoteId = created.body.quote._id;
    const conversationId = created.body.conversationId;

    await new Promise((r) => setTimeout(r, 50));
    expect(pushes.some((p) => /quote/i.test(p.title))).toBe(true);

    // 2. Admin sees it in dashboard queue
    const list = await request(app)
      .get('/quotes?status=new')
      .set('Authorization', `Bearer ${token}`);
    expect(list.status).toBe(200);
    expect(list.body.quotes.some((q) => q._id === quoteId)).toBe(true);

    // 3. Admin sets price and marks quoted
    const patched = await request(app)
      .patch(`/quotes/${quoteId}`)
      .set('Authorization', `Bearer ${token}`)
      .send({ status: 'quoted', quotedPrice: 275 });
    expect(patched.status).toBe(200);
    expect(patched.body.quote.status).toBe('quoted');
    expect(patched.body.quote.quotedPrice).toBe(275);

    // 4. Customer's conversation receives quoted price as a message
    const messages = await Message.find({ conversationId }).sort({ createdAt: 1 });
    const priceMsg = messages.find(
      (m) => m.sender === 'system' && String(m.text).includes('275')
    );
    expect(priceMsg).toBeDefined();

    const quote = await Quote.findById(quoteId);
    expect(quote.status).toBe('quoted');
    expect(String(quote.conversationId)).toBe(String(conversationId));
  });
});