import { describe, it, expect, beforeAll, afterAll, beforeEach } from '@jest/globals';
import request from 'supertest';
import { createApp } from '../../src/app.js';
import { startTestDb, stopTestDb, clearDb } from '../helpers/db.js';
import { KnowledgeBaseEntry } from '../../src/models/KnowledgeBaseEntry.js';
import { Conversation } from '../../src/models/Conversation.js';
import { setEmbedOverride, resetEmbedOverride } from '../../src/services/embedding.js';
import { setLlmOverride, resetLlmOverride } from '../../src/services/llm.js';

function unit(i) {
  const v = Array(384).fill(0);
  v[i % 384] = 1;
  return v;
}

describe('POST /chat/message (Phase 3)', () => {
  let app;

  beforeAll(async () => {
    process.env.JWT_SECRET = 'test-jwt-secret-for-jest';
    process.env.RAG_SIMILARITY_THRESHOLD = '0.5';
    await startTestDb();
    app = createApp();
  });

  afterAll(async () => {
    resetEmbedOverride();
    resetLlmOverride();
    await stopTestDb();
  });

  beforeEach(async () => {
    await clearDb();
    resetEmbedOverride();
    resetLlmOverride();
  });

  it('returns a relevant answer and stays ai_handling when KB matches', async () => {
    const kbVec = unit(0);
    await KnowledgeBaseEntry.create({
      title: 'Airport fares',
      content: 'Airport transfers start at $50.',
      chunks: [{ text: 'Airport transfers start at $50.', embedding: kbVec }],
    });

    setEmbedOverride(async () => kbVec);
    setLlmOverride(async () => 'Airport transfers start at $50.');

    const res = await request(app).post('/chat/message').send({
      text: 'How much is an airport transfer?',
      customerName: 'Sam',
      customerContact: 'sam@example.com',
    });

    expect(res.status).toBe(200);
    expect(res.body.escalated).toBe(false);
    expect(res.body.answer).toMatch(/\$50/);
    expect(res.body.status).toBe('ai_handling');
  });

  it('escalates when question is unrelated (low similarity)', async () => {
    await KnowledgeBaseEntry.create({
      title: 'Airport fares',
      content: 'Airport transfers start at $50.',
      chunks: [{ text: 'Airport transfers start at $50.', embedding: unit(0) }],
    });

    setEmbedOverride(async () => unit(100)); // nearly orthogonal
    setLlmOverride(async () => 'should not be called');

    const res = await request(app).post('/chat/message').send({
      text: 'What is the capital of Mars?',
      customerContact: 'a@b.com',
    });

    expect(res.status).toBe(200);
    expect(res.body.escalated).toBe(true);
    expect(res.body.answer).toBeNull();
    expect(res.body.status).toBe('needs_human');
    expect(res.body.reason).toBe('low_similarity');
  });

  it('escalates immediately when knowledge base is empty', async () => {
    setEmbedOverride(async () => unit(0));
    setLlmOverride(async () => 'nope');

    const res = await request(app).post('/chat/message').send({
      text: 'Any question',
      customerContact: 'empty@test.com',
    });

    expect(res.body.escalated).toBe(true);
    expect(res.body.reason).toBe('empty_kb');
    expect(res.body.answer).toBeNull();
  });

  it('escalates when customer asks to talk to a human', async () => {
    await KnowledgeBaseEntry.create({
      title: 'Hours',
      content: 'Open 9-5',
      chunks: [{ text: 'Open 9-5', embedding: unit(0) }],
    });
    setEmbedOverride(async () => unit(0));
    setLlmOverride(async () => 'Open 9-5');

    const res = await request(app).post('/chat/message').send({
      text: 'I want to talk to a human please',
      customerContact: 'h@test.com',
    });

    expect(res.body.escalated).toBe(true);
    expect(res.body.reason).toBe('explicit_human_request');
  });

  it('answers greetings without escalating', async () => {
    await KnowledgeBaseEntry.create({
      title: 'Hours',
      content: 'Open 9-5',
      chunks: [{ text: 'Open 9-5', embedding: unit(0) }],
    });
    setEmbedOverride(async () => unit(100));
    setLlmOverride(async () => 'should not be called');

    const res = await request(app).post('/chat/message').send({
      text: 'hi',
      customerContact: 'hi@test.com',
    });

    expect(res.status).toBe(200);
    expect(res.body.escalated).toBe(false);
    expect(res.body.status).toBe('ai_handling');
    expect(res.body.answer).toMatch(/guided|option|Durrah/i);
    expect(res.body.options?.length).toBeGreaterThan(2);
  });

  it('guided choice returns canned answer without LLM', async () => {
    setEmbedOverride(async () => unit(0));
    setLlmOverride(async () => 'should not be called');

    const res = await request(app).post('/chat/message').send({
      choiceId: 'hours',
      customerContact: 'guided@test.com',
    });

    expect(res.status).toBe(200);
    expect(res.body.escalated).toBe(false);
    expect(res.body.reason).toBe('guided');
    expect(res.body.answer).toMatch(/AST|8:00/i);
    expect(res.body.options?.some((o) => o.id === 'about')).toBe(true);
  });

  it('escalates gracefully when LLM fails', async () => {
    await KnowledgeBaseEntry.create({
      title: 'Hours',
      content: 'Open 9-5',
      chunks: [{ text: 'Open 9-5', embedding: unit(0) }],
    });
    setEmbedOverride(async () => unit(0));
    setLlmOverride(async () => {
      throw new Error('timeout');
    });

    const res = await request(app).post('/chat/message').send({
      text: 'What are your hours?',
      customerContact: 'llm@test.com',
    });

    expect(res.body.escalated).toBe(true);
    expect(res.body.reason).toBe('llm_failure');
    expect(res.body.answer).toBeNull();

    const conv = await Conversation.findById(res.body.conversationId);
    expect(conv.status).toBe('needs_human');
  });
});