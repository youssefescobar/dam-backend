import { describe, it, expect, beforeAll, afterAll, beforeEach } from '@jest/globals';
import request from 'supertest';
import { createApp } from '../../src/app.js';
import { startTestDb, stopTestDb, clearDb } from '../helpers/db.js';
import { KnowledgeBaseEntry } from '../../src/models/KnowledgeBaseEntry.js';
import { Conversation } from '../../src/models/Conversation.js';
import { setLlmOverride, resetLlmOverride } from '../../src/services/llm.js';

async function openSession(app, overrides = {}) {
  const res = await request(app)
    .post('/chat/session')
    .send({
      name: 'Sam',
      email: `sam-${Date.now()}@example.com`,
      phone: `+1555${String(Date.now()).slice(-7)}`,
      ...overrides,
    });
  expect(res.status).toBe(201);
  return res.body;
}

describe('POST /chat/session & /chat/message', () => {
  let app;

  beforeAll(async () => {
    process.env.JWT_SECRET = 'test-jwt-secret-for-jest';
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
  });

  it('rejects messaging without a session or full identity', async () => {
    const res = await request(app).post('/chat/message').send({
      text: 'hi',
      customerContact: 'only-contact@example.com',
    });
    expect(res.status).toBe(400);
  });

  it('starts a session with name, email, and phone', async () => {
    const res = await request(app).post('/chat/session').send({
      name: 'Ada',
      email: 'ada@example.com',
      phone: '+15555550123',
    });
    expect(res.status).toBe(201);
    expect(res.body.conversationId).toBeTruthy();
    expect(res.body.customer.name).toBe('Ada');
    expect(res.body.customer.email).toBe('ada@example.com');
    expect(res.body.customer.phone).toBe('+15555550123');
  });

  it('returns a relevant answer and stays ai_handling when FAQ is present', async () => {
    await KnowledgeBaseEntry.create({
      title: 'How much is an airport transfer?',
      content: 'Airport transfers start at $50.',
    });

    setLlmOverride(async ({ context }) => {
      expect(context).toMatch(/Airport transfers start at \$50/);
      return 'Airport transfers start at $50.';
    });

    const session = await openSession(app);
    const res = await request(app).post('/chat/message').send({
      text: 'How much is an airport transfer?',
      conversationId: session.conversationId,
    });

    expect(res.status).toBe(200);
    expect(res.body.escalated).toBe(false);
    expect(res.body.answer).toMatch(/\$50/);
    expect(res.body.status).toBe('ai_handling');
    expect(res.body.reason).toBe('faq');
  });

  it('escalates when the model cannot answer from the FAQ', async () => {
    await KnowledgeBaseEntry.create({
      title: 'Airport fares',
      content: 'Airport transfers start at $50.',
    });

    setLlmOverride(async () => "I don't know");

    const session = await openSession(app, { email: 'a@b.com', phone: '+15555550001' });
    const res = await request(app).post('/chat/message').send({
      text: 'What is the capital of Mars?',
      conversationId: session.conversationId,
    });

    expect(res.status).toBe(200);
    expect(res.body.escalated).toBe(true);
    expect(res.body.answer).toBeNull();
    expect(res.body.status).toBe('needs_human');
    expect(res.body.reason).toBe('model_uncertain');
  });

  it('soft-fails when knowledge base is empty without locking', async () => {
    setLlmOverride(async () => 'nope');

    const session = await openSession(app, { email: 'empty@test.com', phone: '+15555550002' });
    const res = await request(app).post('/chat/message').send({
      text: 'Any question',
      conversationId: session.conversationId,
    });

    expect(res.status).toBe(200);
    expect(res.body.escalated).toBe(false);
    expect(res.body.reason).toBe('empty_kb');
    expect(res.body.answer).toMatch(/knowledge|menu|human/i);
    expect(res.body.status).toBe('ai_handling');
  });

  it('escalates when customer asks to talk to a human', async () => {
    await KnowledgeBaseEntry.create({
      title: 'Hours',
      content: 'Open 9-5',
    });
    setLlmOverride(async () => 'Open 9-5');

    const session = await openSession(app, { email: 'h@test.com', phone: '+15555550003' });
    const res = await request(app).post('/chat/message').send({
      text: 'I want to talk to a human please',
      conversationId: session.conversationId,
    });

    expect(res.body.escalated).toBe(true);
    expect(res.body.reason).toBe('explicit_human_request');
  });

  it('answers greetings without escalating', async () => {
    await KnowledgeBaseEntry.create({
      title: 'Hours',
      content: 'Open 9-5',
    });
    setLlmOverride(async () => 'should not be called');

    const session = await openSession(app, { email: 'hi@test.com', phone: '+15555550004' });
    const res = await request(app).post('/chat/message').send({
      text: 'hi',
      conversationId: session.conversationId,
    });

    expect(res.status).toBe(200);
    expect(res.body.escalated).toBe(false);
    expect(res.body.status).toBe('ai_handling');
    expect(res.body.answer).toMatch(/guided|option|Durrah/i);
    expect(res.body.options?.length).toBeGreaterThan(2);
  });

  it('guided choice returns canned answer without LLM', async () => {
    setLlmOverride(async () => 'should not be called');

    const session = await openSession(app, { email: 'guided@test.com', phone: '+15555550005' });
    const res = await request(app).post('/chat/message').send({
      choiceId: 'hours',
      conversationId: session.conversationId,
    });

    expect(res.status).toBe(200);
    expect(res.body.escalated).toBe(false);
    expect(res.body.reason).toBe('guided');
    expect(res.body.answer).toMatch(/8 AM|8 PM|Saturday|hours/i);
    expect(res.body.options?.some((o) => o.id === 'about')).toBe(true);
  });

  it('soft-fails when LLM fails without locking the conversation', async () => {
    await KnowledgeBaseEntry.create({
      title: 'Hours',
      content: 'Open 9-5',
    });
    setLlmOverride(async () => {
      throw new Error('timeout');
    });

    const session = await openSession(app, { email: 'llm@test.com', phone: '+15555550006' });
    const res = await request(app).post('/chat/message').send({
      text: 'What are your hours?',
      conversationId: session.conversationId,
    });

    expect(res.status).toBe(200);
    expect(res.body.escalated).toBe(false);
    expect(res.body.reason).toBe('llm_failure');
    expect(res.body.answer).toMatch(/trouble|menu|human|stuck/i);
    expect(res.body.options?.length).toBeGreaterThan(0);
    expect(res.body.detail).toMatch(/timeout/i);

    const conv = await Conversation.findById(res.body.conversationId);
    expect(conv.status).toBe('ai_handling');
  });
});
