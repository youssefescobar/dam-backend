import { describe, it, expect, beforeAll, afterAll, beforeEach } from '@jest/globals';
import request from 'supertest';
import bcrypt from 'bcryptjs';
import { createApp } from '../../src/app.js';
import { startTestDb, stopTestDb, clearDb } from '../helpers/db.js';
import { Admin } from '../../src/models/Admin.js';
import { KnowledgeBaseEntry } from '../../src/models/KnowledgeBaseEntry.js';
import { Settings } from '../../src/models/Settings.js';
import { setLlmOverride, resetLlmOverride } from '../../src/services/llm.js';
import { availabilityNote } from '../../src/services/chat.js';

describe('unanswered log, analytics, rate limit, office hours', () => {
  let app;
  let token;

  const session = async () =>
    (await request(app).post('/chat/session').send({ name: 'Sam', phone: `+1555${Date.now().toString().slice(-7)}` })).body;
  const ask = (conversationId, text, extra = {}) =>
    request(app).post('/chat/message').send({ conversationId, text, ...extra });

  beforeAll(async () => {
    await startTestDb();
    app = createApp();
  });
  afterAll(async () => {
    resetLlmOverride();
    await stopTestDb();
  });
  beforeEach(async () => {
    await clearDb();
    resetLlmOverride();
    await Admin.create({
      name: 'Ops',
      email: 'ops@test.com',
      passwordHash: await bcrypt.hash('password123', 10),
      role: 'admin',
    });
    token = (await request(app).post('/auth/login').send({ email: 'ops@test.com', password: 'password123' })).body.token;
    await KnowledgeBaseEntry.create({ title: 'Hours', content: 'We open 9-5', locale: 'en' });
  });

  it('logs unanswered questions (grouped, admin-only, resolvable)', async () => {
    setLlmOverride(async () => "I don't know");
    const { conversationId } = await session();
    await ask(conversationId, 'Do you ship goats?');
    await ask(conversationId, 'do you  ship GOATS?');

    expect((await request(app).get('/insights/unanswered')).status).toBe(401);
    const list = await request(app).get('/insights/unanswered').set('Authorization', `Bearer ${token}`);
    expect(list.body.items).toHaveLength(1);
    expect(list.body.items[0]).toMatchObject({ count: 2, reason: 'model_uncertain', language: 'en' });

    const id = list.body.items[0]._id;
    await request(app).patch(`/insights/unanswered/${id}`).set('Authorization', `Bearer ${token}`).send({ status: 'resolved' });
    const open = await request(app).get('/insights/unanswered').set('Authorization', `Bearer ${token}`);
    expect(open.body.items).toHaveLength(0);
  });

  it('computes miss and handover rates', async () => {
    setLlmOverride(async ({ question }) => (question.includes('goats') ? "I don't know" : 'We open 9-5.'));
    const { conversationId } = await session();
    await ask(conversationId, 'what are your business hours exactly');
    await ask(conversationId, 'goats?');
    await ask(conversationId, 'talk to a human');

    const res = await request(app).get('/insights/analytics').set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(200);
    expect(res.body.conversations).toBe(1);
    expect(res.body.handoverRate).toBe(1);
    expect(res.body.handovers.explicit_human_request).toBe(1);
    expect(res.body.misses).toBe(1);
    expect(res.body.missRate).toBe(0.5);
  });

  it('rate-limits per conversation with a localised 429', async () => {
    process.env.CHAT_CUSTOMER_MAX_PER_MIN = '2';
    try {
      const a = await session();
      const b = await session();
      await ask(a.conversationId, 'hi');
      await ask(a.conversationId, 'hi');
      const blocked = await ask(a.conversationId, 'hi', { lang: 'ar' });
      expect(blocked.status).toBe(429);
      expect(blocked.body.error).toMatch(/[؀-ۿ]/);
      expect((await ask(b.conversationId, 'hi')).status).toBe(200);
    } finally {
      delete process.env.CHAT_CUSTOMER_MAX_PER_MIN;
    }
  });

  it('mentions offline team only outside configured office hours', async () => {
    expect(await availabilityNote('en')).toBe(''); // feature off by default
    await Settings.updateOne({ _id: 'company' }, { officeHoursEnabled: true, timezone: 'UTC', officeDays: [0], officeStart: '09:00', officeEnd: '17:00' });
    // Sunday 2024-01-07 12:00 UTC: open. Saturday 2024-01-06 12:00 UTC: closed, back Sunday.
    expect(await availabilityNote('en', new Date('2024-01-07T12:00:00Z'))).toBe('');
    expect(await availabilityNote('en', new Date('2024-01-06T12:00:00Z'))).toMatch(/offline.*Sunday at 09:00/);
    expect(await availabilityNote('ar', new Date('2024-01-06T12:00:00Z'))).toMatch(/الأحد/);
  });
});
