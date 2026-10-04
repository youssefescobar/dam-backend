import { describe, it, expect, beforeAll, afterAll, beforeEach } from '@jest/globals';
import request from 'supertest';
import { createApp } from '../../src/app.js';
import { startTestDb, stopTestDb, clearDb } from '../helpers/db.js';
import { KnowledgeBaseEntry } from '../../src/models/KnowledgeBaseEntry.js';
import { Conversation } from '../../src/models/Conversation.js';
import { Settings } from '../../src/models/Settings.js';
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

  it('does not escalate on the first unanswerable question — it offers a person', async () => {
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
    expect(res.body.escalated).toBe(false);
    expect(res.body.status).toBe('ai_handling');
    expect(res.body.reason).toBe('model_uncertain');
    expect(res.body.answer).toMatch(/connect you|team|topic/i);
    expect(res.body.options.some((o) => o.id === 'human')).toBe(true);
  });

  it('hands over to a person after three unanswered turns in a row', async () => {
    await KnowledgeBaseEntry.create({ title: 'Airport fares', content: 'From $50.' });
    setLlmOverride(async () => "I don't know");

    const session = await openSession(app);
    const ask = (text) =>
      request(app).post('/chat/message').send({ text, conversationId: session.conversationId });

    expect((await ask('Question one about Mars')).body.escalated).toBe(false);
    expect((await ask('Question two about Venus')).body.escalated).toBe(false);
    const third = await ask('Question three about Jupiter');
    expect(third.body.escalated).toBe(true);
    expect(third.body.status).toBe('needs_human');
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
    expect(res.body.options?.some((o) => o.id === 'quote')).toBe(true);
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

  it('answers the guided menu in Arabic when the site locale is Arabic', async () => {
    setLlmOverride(async () => 'should not be called');
    const session = await openSession(app, { lang: 'ar' });

    const welcome = await request(app).get('/chat/guided?lang=ar');
    expect(welcome.body.answer).toMatch(/دُرّي/);
    expect(welcome.body.options[0].label).toMatch(/[\u0600-\u06FF]/);

    const res = await request(app).post('/chat/message').send({
      choiceId: 'airport',
      conversationId: session.conversationId,
      lang: 'ar',
    });
    expect(res.body.answer).toMatch(/[\u0600-\u06FF]/);
    expect(res.body.options.every((o) => /[\u0600-\u06FF]/.test(o.label))).toBe(true);
    const quoteBtn = res.body.options.find((o) => o.id === 'open_quote');
    expect(quoteBtn?.href).toBe('/quote');
  });

  it('switches to Arabic when the customer types Arabic, and passes history + lang to the model', async () => {
    await KnowledgeBaseEntry.create({ title: 'ساعات العمل', content: 'من الأحد إلى الخميس' });
    let seen;
    setLlmOverride(async (args) => {
      seen = args;
      return 'نعم، نعمل من الأحد إلى الخميس.';
    });
    const session = await openSession(app);
    await request(app).post('/chat/message').send({
      text: 'هل تعملون يوم الجمعة؟',
      conversationId: session.conversationId,
    });
    expect(seen.lang).toBe('ar');
    expect(seen.history.length).toBeGreaterThan(0);
    expect(seen.history[seen.history.length - 1].role).toBe('user');
    const conv = await Conversation.findById(session.conversationId);
    expect(conv.language).toBe('ar');
  });

  it('routes explicit quote / complaint / lost-item requests without the LLM', async () => {
    setLlmOverride(async () => 'should not be called');
    const session = await openSession(app);
    const say = (text) =>
      request(app).post('/chat/message').send({ text, conversationId: session.conversationId });

    const quote = await say('I want to get a quote');
    expect(quote.body.reason).toBe('guided');
    expect(quote.body.options.some((o) => o.id === 'open_quote')).toBe(true);

    const lost = await say('I left my bag on the bus');
    expect(lost.body.reason).toBe('flow_started');
  });

  it('understands Arabic human requests and chit-chat', async () => {
    setLlmOverride(async () => 'should not be called');
    const session = await openSession(app);
    const thanks = await request(app)
      .post('/chat/message')
      .send({ text: 'شكرا', conversationId: session.conversationId });
    expect(thanks.body.reason).toBe('chitchat');
    expect(thanks.body.answer).toMatch(/العفو/);

    const human = await request(app)
      .post('/chat/message')
      .send({ text: 'أبغى أكلم موظف', conversationId: session.conversationId });
    expect(human.body.escalated).toBe(true);
    expect(human.body.systemMessage).toMatch(/[\u0600-\u06FF]/);
  });

  it('restores a chat after reload only for the right phone, and returns message ids', async () => {
    setLlmOverride(async () => 'should not be called');
    const phone = '+966555000222';
    const session = await openSession(app, { phone });
    const reply = await request(app)
      .post('/chat/message')
      .send({ choiceId: 'hours', conversationId: session.conversationId });
    expect(reply.body.messageId).toMatch(/^[a-f0-9]{24}$/);

    const ok = await request(app)
      .get('/chat/history')
      .query({ conversationId: session.conversationId, phone });
    expect(ok.status).toBe(200);
    expect(ok.body.resumable).toBe(true);
    expect(ok.body.messages.map((m) => m.sender)).toEqual(['customer', 'ai']);
    expect(ok.body.options.length).toBeGreaterThan(3);

    const wrong = await request(app)
      .get('/chat/history')
      .query({ conversationId: session.conversationId, phone: '+966500000000' });
    expect(wrong.status).toBe(404);

    await Conversation.findByIdAndUpdate(session.conversationId, { status: 'closed' });
    const closed = await request(app)
      .get('/chat/history')
      .query({ conversationId: session.conversationId, phone });
    expect(closed.body.resumable).toBe(false);
  });

  it('hands over immediately when the model answers ESCALATE', async () => {
    await KnowledgeBaseEntry.create({ title: 'Accident', content: 'Escalate immediately', escalate: true });
    setLlmOverride(async () => 'ESCALATE');
    const session = await openSession(app);
    const res = await request(app).post('/chat/message').send({
      text: 'The driver hit a parked car near the gate',
      conversationId: session.conversationId,
    });
    expect(res.body.escalated).toBe(true);
    expect(res.body.reason).toBe('model_escalate');
    expect(res.body.status).toBe('needs_human');
  });

  it('never fails on a link-button or unknown choice id', async () => {
    setLlmOverride(async () => 'should not be called');
    const session = await openSession(app);
    const quote = await request(app)
      .post('/chat/message')
      .send({ choiceId: 'open_quote', conversationId: session.conversationId });
    expect(quote.status).toBe(200);
    expect(quote.body.reason).toBe('guided');
    expect(quote.body.answer).toMatch(/quote/i);

    const unknown = await request(app)
      .post('/chat/message')
      .send({ choiceId: 'does_not_exist', conversationId: session.conversationId });
    expect(unknown.status).toBe(200);
    expect(unknown.body.options.length).toBeGreaterThan(3);
  });

  it('ignores the old stock greeting stored in settings so Durri introduces itself', async () => {
    await Settings.create({
      _id: 'company',
      botGreetingEn:
        'Welcome to Durrah Al-Munawwara Transport. How can I help? Choose booking or quote, trip follow-up, Hajj & Umrah, corporate transport, international, complaint or lost items, or talk to an agent.',
      botGreetingAr: 'أهلاً بك في درة المنورة للنقل. كيف أستطيع مساعدتك؟ يمكنك اختيار حجز أو عرض سعر، متابعة رحلة، الحج والعمرة، نقل الشركات، النقل الدولي، شكوى أو مفقودات، أو التحدث مع موظف.',
    });
    expect((await request(app).get('/chat/guided?lang=en')).body.answer).toMatch(/Durri/);
    expect((await request(app).get('/chat/guided?lang=ar')).body.answer).toMatch(/دُرّي/);

    await Settings.updateOne({ _id: 'company' }, { botGreetingEn: 'Custom hello from the team.' });
    expect((await request(app).get('/chat/guided?lang=en')).body.answer).toBe('Custom hello from the team.');
  });
});
