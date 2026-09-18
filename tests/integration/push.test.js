import { describe, it, expect, beforeAll, afterAll, beforeEach } from '@jest/globals';
import request from 'supertest';
import bcrypt from 'bcryptjs';
import { createApp } from '../../src/app.js';
import { startTestDb, stopTestDb, clearDb } from '../helpers/db.js';
import { Admin } from '../../src/models/Admin.js';
import { setPushImplementation, notifyAdmins } from '../../src/services/push.js';

describe('Push notifications (Phase 5)', () => {
  let app;
  let token;
  let adminId;
  const sent = [];

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
    sent.length = 0;

    const passwordHash = await bcrypt.hash('password123', 10);
    const admin = await Admin.create({
      name: 'Push Admin',
      email: 'push@test.com',
      passwordHash,
      role: 'admin',
    });
    adminId = admin._id;

    const login = await request(app)
      .post('/auth/login')
      .send({ email: 'push@test.com', password: 'password123' });
    token = login.body.token;

    setPushImplementation(async (payload) => {
      const admins = await Admin.find({ 'pushSubscriptions.0': { $exists: true } });
      for (const a of admins) {
        const remaining = [];
        for (const sub of a.pushSubscriptions) {
          if (sub.endpoint.includes('expired')) {
            continue;
          }
          sent.push({ adminId: a._id.toString(), endpoint: sub.endpoint, payload });
          remaining.push(sub);
        }
        a.pushSubscriptions = remaining;
        await a.save();
      }
    });
  });

  it('subscribing stores a valid subscription tied to the admin', async () => {
    const res = await request(app)
      .post('/push/subscribe')
      .set('Authorization', `Bearer ${token}`)
      .send({
        endpoint: 'https://push.example.com/sub/1',
        keys: { p256dh: 'p256dh-key', auth: 'auth-key' },
      });

    expect(res.status).toBe(201);
    const admin = await Admin.findById(adminId);
    expect(admin.pushSubscriptions).toHaveLength(1);
    expect(admin.pushSubscriptions[0].endpoint).toContain('push.example.com');
  });

  it('unsubscribing removes the endpoint for that admin', async () => {
    await request(app)
      .post('/push/subscribe')
      .set('Authorization', `Bearer ${token}`)
      .send({
        endpoint: 'https://push.example.com/sub/1',
        keys: { p256dh: 'p256dh-key', auth: 'auth-key' },
      });

    const res = await request(app)
      .post('/push/unsubscribe')
      .set('Authorization', `Bearer ${token}`)
      .send({ endpoint: 'https://push.example.com/sub/1' });

    expect(res.status).toBe(200);
    expect(res.body.removed).toBe(1);
    const admin = await Admin.findById(adminId);
    expect(admin.pushSubscriptions).toHaveLength(0);
  });

  it('new quote triggers push to all subscribed admins', async () => {
    await request(app)
      .post('/push/subscribe')
      .set('Authorization', `Bearer ${token}`)
      .send({
        endpoint: 'https://push.example.com/sub/1',
        keys: { p256dh: 'x', auth: 'y' },
      });

    const res = await request(app).post('/quotes').send({
      customerName: 'Push Customer',
      customerContact: 'pc@test.com',
      pickup: 'A',
      dropoff: 'B',
      date: '2026-11-01',
      vehicleType: 'van',
      passengers: 3,
    });
    expect(res.status).toBe(201);

    await new Promise((r) => setTimeout(r, 50));

    expect(sent.length).toBeGreaterThanOrEqual(1);
    expect(sent[0].payload.title).toMatch(/quote/i);
  });

  it('removes expired subscriptions after failed push', async () => {
    const admin = await Admin.findById(adminId);
    admin.pushSubscriptions = [
      {
        endpoint: 'https://push.example.com/expired',
        keys: { p256dh: 'x', auth: 'y' },
      },
      {
        endpoint: 'https://push.example.com/good',
        keys: { p256dh: 'x', auth: 'y' },
      },
    ];
    await admin.save();

    await notifyAdmins({ title: 'Test', body: 'Hello' });

    const refreshed = await Admin.findById(adminId);
    expect(refreshed.pushSubscriptions).toHaveLength(1);
    expect(refreshed.pushSubscriptions[0].endpoint).toContain('good');
    expect(sent).toHaveLength(1);
  });
});

describe('Widget static assets', () => {
  it('serves customer chat widget assets', async () => {
    const app = createApp();
    const css = await request(app).get('/widget/chat-widget.css');
    expect(css.status).toBe(200);
    const page = await request(app).get('/widget/');
    expect(page.status).toBe(200);
  });
});
