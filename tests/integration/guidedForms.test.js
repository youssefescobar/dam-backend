import { describe, it, expect, beforeAll, afterAll, beforeEach } from '@jest/globals';
import request from 'supertest';
import { createApp } from '../../src/app.js';
import { startTestDb, stopTestDb, clearDb } from '../helpers/db.js';
import { Report } from '../../src/models/Report.js';
import { Conversation } from '../../src/models/Conversation.js';
import { isImmediateSafetyEscalation } from '../../src/services/llm.js';

describe('chat sessions without email, guided forms, escalation triggers', () => {
  let app;

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
  });

  const open = async (body = { name: 'Lina', phone: '+966555000111' }) => {
    const res = await request(app).post('/chat/session').send(body);
    expect(res.status).toBe(201);
    return res.body.conversationId;
  };

  const say = (conversationId, payload) =>
    request(app).post('/chat/message').send({ conversationId, ...payload });

  it('starts a session with only name and phone', async () => {
    const res = await request(app)
      .post('/chat/session')
      .send({ name: 'Lina', phone: '+966555000111' });
    expect(res.status).toBe(201);
    expect(res.body.customer.name).toBe('Lina');
    expect(res.body.customer.phone).toBe('+966555000111');
  });

  it('walks a complaint through the form and logs a report with a reference number', async () => {
    const id = await open();
    let res = await say(id, { choiceId: 'complaint' });
    expect(res.status).toBe(200);
    expect(res.body.answer).toMatch(/trip or booking number/i);

    res = await say(id, { text: 'BK-1234' });
    expect(res.body.answer).toMatch(/what date/i);
    res = await say(id, { text: '2026-10-01' });
    expect(res.body.answer).toMatch(/describe/i);
    res = await say(id, { text: 'The air conditioning was broken the whole trip' });
    expect(res.body.answer).toMatch(/CMP-[0-9A-F]{8}/);
    expect(res.body.answer).toMatch(/48 hours/);

    const reports = await Report.find({}).lean();
    expect(reports).toHaveLength(1);
    expect(reports[0].type).toBe('complaint');
    expect(reports[0].tripNumber).toBe('BK-1234');
    expect(reports[0].phone).toBe('+966555000111');
  });

  it('collects a lost item and lets the user cancel mid-form', async () => {
    const id = await open();
    await say(id, { choiceId: 'lost_found' });
    const res = await say(id, { text: 'cancel' });
    expect(res.body.answer).toMatch(/cancelled/i);
    expect(await Report.countDocuments()).toBe(0);

    await say(id, { choiceId: 'lost_found' });
    await say(id, { text: 'Bus 17' });
    await say(id, { text: '2026-09-30' });
    await say(id, { text: 'evening' });
    await say(id, { text: 'skip' });
    const done = await say(id, { text: 'Black backpack with a red tag' });
    expect(done.body.answer).toMatch(/LF-[0-9A-F]{8}/);
    const report = await Report.findOne({ type: 'lost_found' }).lean();
    expect(report.seat).toBe('');
    expect(report.description).toMatch(/backpack/);
  });

  it('escalates safety and payment-dispute messages even mid-form', async () => {
    const id = await open();
    await say(id, { choiceId: 'complaint' });
    const res = await say(id, { text: 'the driver was speeding and we nearly had an accident' });
    expect(res.body.escalated).toBe(true);
  });

  it('drops a half-finished form when the chat is escalated and later reopened', async () => {
    const id = await open();
    await say(id, { choiceId: 'complaint' });
    await say(id, { text: 'there was an accident' });
    let conv = await Conversation.findById(id);
    expect(conv.flow).toBeNull();

    conv.status = 'closed';
    await conv.save();
    const res = await say(id, { text: 'hello again' });
    expect(res.status).toBe(200);
    expect(await Report.countDocuments()).toBe(0);
    conv = await Conversation.findById(id);
    expect(conv.flow).toBeNull();
  });

  it('recognises the hard escalation triggers but not lost-item talk', () => {
    for (const text of [
      'there was an accident',
      'driver was reckless',
      'my child is missing',
      'I was double charged',
      'this is fraud',
      'حصل حادث',
      'طفل مفقود',
    ]) {
      expect(isImmediateSafetyEscalation(text)).toBe(true);
    }
    for (const text of ['I lost my bag', 'مفقودات', 'how much is a ticket']) {
      expect(isImmediateSafetyEscalation(text)).toBe(false);
    }
  });
});
