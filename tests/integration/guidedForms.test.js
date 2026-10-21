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
    expect(res.body.answer).toMatch(/photo/i);
    expect(res.body.upload).toMatchObject({ optional: true, accept: expect.arrayContaining(['image/jpeg']) });
    res = await say(id, { text: 'skip' });
    expect(res.body.answer).toMatch(/CMP-[0-9A-F]{8}/);
    expect(res.body.answer).toMatch(/48 hours/);
    expect(res.body.answer).not.toMatch(/WhatsApp/);

    const reports = await Report.find({}).lean();
    expect(reports).toHaveLength(1);
    expect(reports[0].type).toBe('complaint');
    expect(reports[0].tripNumber).toBe('BK-1234');
    expect(reports[0].phone).toBe('+966555000111');
  });

  const MB = 1024 * 1024;
  const cvKey = (id, ext = 'pdf') => `chat/${id}/3cf7dea5-e8c1-4356-8d65-189f2d0aff40.${ext}`;

  it('takes a job application with a CV and lets the user cancel mid-form', async () => {
    const id = await open();
    await say(id, { choiceId: 'careers' });
    let res = await say(id, { text: 'cancel' });
    expect(res.body.answer).toMatch(/cancelled/i);

    res = await say(id, { text: 'I want to apply for a job' });
    expect(res.body.reason).toBe('flow_started');
    expect(res.body.upload).toBeNull();
    res = await say(id, { text: 'Bus driver' });
    expect(res.body.upload).toMatchObject({ optional: false, maxMb: 10 });

    // No upload slot outside a file step, or for the wrong type / size.
    expect((await request(app).post('/chat/upload').send({ conversationId: id, contentType: 'image/png', size: 100 })).status).toBe(400);
    expect((await request(app).post('/chat/upload').send({ conversationId: id, contentType: 'application/pdf', size: 11 * MB })).status).toBe(400);

    // Typed text where the CV is needed: explain and keep waiting.
    res = await say(id, { text: 'I will send it later' });
    expect(res.body.answer).toMatch(/paperclip/i);
    expect(res.body.upload).not.toBeNull();

    // A key from another chat, or a type this step doesn't take, is refused.
    const other = '0123456789abcdef01234567';
    expect((await say(id, { attachment: { key: cvKey(other), name: 'cv.pdf' } })).status).toBe(400);
    expect((await say(id, { attachment: { key: cvKey(id, 'png'), name: 'cv.png' } })).status).toBe(400);

    // A filename with alarm words is just a filename.
    const done = await say(id, { attachment: { key: cvKey(id), name: 'Emergency_accident_CV.pdf' } });
    expect(done.status).toBe(200);
    expect(done.body.escalated).toBe(false);
    expect(done.body.answer).toMatch(/JOB-[0-9A-F]{8}/);

    const report = await Report.findOne({ type: 'career' }).lean();
    expect(report.position).toBe('Bus driver');
    expect(report.attachments).toEqual([
      { field: 'cv', key: cvKey(id), name: 'Emergency_accident_CV.pdf', contentType: 'application/pdf' },
    ]);
    expect((await say(id, { attachment: { key: cvKey(id), name: 'again.pdf' } })).status).toBe(400);
  });

  it('accepts an optional complaint photo', async () => {
    const id = await open();
    await say(id, { choiceId: 'complaint' });
    for (const text of ['BK-9', '2026-10-01', 'Seat was broken']) await say(id, { text });
    const res = await say(id, { attachment: { key: cvKey(id, 'jpg'), name: 'seat.jpg' } });
    expect(res.body.answer).toMatch(/CMP-/);
    const report = await Report.findOne({ type: 'complaint' }).lean();
    expect(report.attachments[0]).toMatchObject({ field: 'photo', contentType: 'image/jpeg' });
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

  it('recognises the hard escalation triggers but not everyday questions', () => {
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
    for (const text of ['how much is a ticket', 'كم سعر التذكرة']) {
      expect(isImmediateSafetyEscalation(text)).toBe(false);
    }
  });
});
