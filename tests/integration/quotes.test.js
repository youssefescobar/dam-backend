import { describe, it, expect, beforeAll, afterAll, beforeEach } from '@jest/globals';
import request from 'supertest';
import bcrypt from 'bcryptjs';
import { createApp } from '../../src/app.js';
import { startTestDb, stopTestDb, clearDb } from '../helpers/db.js';
import { Admin } from '../../src/models/Admin.js';
import { Quote } from '../../src/models/Quote.js';
import { Message } from '../../src/models/Message.js';
import { KnowledgeBaseEntry } from '../../src/models/KnowledgeBaseEntry.js';

// These tests submit many quotes from one phone; the spam limit has its own test (launchFixes).
process.env.QUOTE_MAX_PER_PHONE = '1000';

describe('Quotes & Auth & KB (Phase 1)', () => {
  /** @type {import('express').Express} */
  let app;
  let adminToken;

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
      name: 'Test Admin',
      email: 'admin@test.com',
      passwordHash,
      role: 'admin',
    });

    const login = await request(app)
      .post('/auth/login')
      .send({ email: 'admin@test.com', password: 'password123' });
    adminToken = login.body.token;
  });

  describe('POST /quotes', () => {
    it('returns 400 with field-level errors when required fields are missing', async () => {
      const res = await request(app).post('/quotes').send({
        customerName: 'Ada',
        // missing contact, pickup, etc.
      });
      expect(res.status).toBe(400);
      expect(res.body.fields).toBeDefined();
      expect(res.body.fields.customerContact || res.body.fields.pickup).toBeTruthy();
    });

    it('creates a valid quote and persists it', async () => {
      const res = await request(app).post('/quotes').send({
        customerName: 'Ada Lovelace',
        customerContact: 'ada@example.com',
        pickup: 'Airport',
        dropoff: 'Downtown',
        date: '2026-10-01T10:00:00.000Z',
        vehicleType: 'van',
        passengers: 4,
        notes: 'Need child seat',
      });

      expect(res.status).toBe(201);
      expect(res.body.quote).toBeDefined();
      expect(res.body.quote.pickup).toBe('Airport');
      expect(res.body.quote.status).toBe('new');

      const inDb = await Quote.findById(res.body.quote._id);
      expect(inDb).not.toBeNull();
      expect(inDb.dropoff).toBe('Downtown');
    });

    it('keeps every leg of a multi-leg trip in order', async () => {
      const legs = [
        { from: 'Jeddah Airport', to: 'Makkah', date: '2026-11-01', time: '09:00' },
        { from: 'Makkah', to: 'Madinah', date: '2026-11-04', time: '14:30' },
        { from: 'Madinah', to: 'Jeddah Airport', date: '2026-11-08', time: '07:15' },
      ];
      const res = await request(app).post('/quotes').send({
        customerName: 'Ada Lovelace',
        customerContact: '+966500000000',
        pickup: 'Jeddah Airport',
        dropoff: 'Jeddah Airport',
        date: '2026-11-01',
        passengers: 30,
        legs,
      });

      expect(res.status).toBe(201);
      const inDb = await Quote.findById(res.body.quote._id).lean();
      expect(inDb.legs).toEqual(legs);
    });

    it('rejects a leg without a destination', async () => {
      const res = await request(app).post('/quotes').send({
        customerName: 'Ada Lovelace',
        customerContact: '+966500000000',
        pickup: 'Makkah',
        dropoff: 'Madinah',
        date: '2026-11-01',
        passengers: 4,
        legs: [{ from: 'Makkah', to: '' }],
      });
      expect(res.status).toBe(400);
    });

    it('defaults legs to an empty list for single-trip quotes', async () => {
      const res = await request(app).post('/quotes').send({
        customerName: 'Ada Lovelace',
        customerContact: 'ada@example.com',
        pickup: 'Airport',
        dropoff: 'Downtown',
        date: '2026-10-01',
        passengers: 4,
      });
      expect(res.status).toBe(201);
      expect(res.body.quote.legs).toEqual([]);
    });
  });

  describe('Admin auth', () => {
    it('rejects admin routes without a valid JWT', async () => {
      const res = await request(app).get('/quotes');
      expect(res.status).toBe(401);
    });

    it('allows listing quotes with a valid JWT', async () => {
      await request(app).post('/quotes').send({
        customerName: 'Ada',
        customerContact: 'ada@example.com',
        pickup: 'A',
        dropoff: 'B',
        date: '2026-10-01',
        vehicleType: 'sedan',
        passengers: 2,
      });

      const res = await request(app)
        .get('/quotes')
        .set('Authorization', `Bearer ${adminToken}`);
      expect(res.status).toBe(200);
      expect(res.body.quotes.length).toBe(1);
    });

    it('rejects invalid login', async () => {
      const res = await request(app)
        .post('/auth/login')
        .send({ email: 'admin@test.com', password: 'wrong' });
      expect(res.status).toBe(401);
    });
  });

  describe('KB admin routes', () => {
    it('rejects KB create without JWT', async () => {
      const res = await request(app).post('/kb').send({
        title: 'Hours',
        content: 'We are open 9-5',
      });
      expect(res.status).toBe(401);
    });

    it('creates and updates KB FAQ entries without embeddings', async () => {
      const res = await request(app)
        .post('/kb')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ title: 'Hours', content: 'We are open 9-5' });

      expect(res.status).toBe(201);
      expect(res.body.entry.title).toBe('Hours');
      expect(res.body.entry.content).toBe('We are open 9-5');
      expect(res.body.entry.chunks).toBeUndefined();

      const updated = await request(app)
        .put(`/kb/${res.body.entry._id}`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ title: 'Hours', content: 'We are open 8-6' });
      expect(updated.status).toBe(200);
      expect(updated.body.entry.content).toBe('We are open 8-6');

      const count = await KnowledgeBaseEntry.countDocuments();
      expect(count).toBe(1);
    });
  });

  describe('DELETE /quotes/:id', () => {
    const newQuote = () =>
      request(app).post('/quotes').send({
        customerName: 'Ada',
        customerContact: 'ada@example.com',
        pickup: 'A',
        dropoff: 'B',
        date: '2026-10-01',
        passengers: 2,
      });

    it('lets staff delete a quote for good', async () => {
      const created = await newQuote();
      const id = created.body.quote._id;

      const res = await request(app).delete(`/quotes/${id}`).set('Authorization', `Bearer ${adminToken}`);
      expect(res.status).toBe(204);
      expect(await Quote.findById(id)).toBeNull();

      const again = await request(app).delete(`/quotes/${id}`).set('Authorization', `Bearer ${adminToken}`);
      expect(again.status).toBe(404);
    });

    it('needs a staff login and rejects bad ids', async () => {
      const created = await newQuote();
      const anon = await request(app).delete(`/quotes/${created.body.quote._id}`);
      expect(anon.status).toBe(401);
      expect(await Quote.countDocuments()).toBe(1);

      const bad = await request(app).delete('/quotes/not-an-id').set('Authorization', `Bearer ${adminToken}`);
      expect(bad.status).toBe(404);
    });
  });

  describe('PATCH /quotes/:id', () => {
    it('updates status and price', async () => {
      const created = await request(app).post('/quotes').send({
        customerName: 'Ada',
        customerContact: 'ada@example.com',
        pickup: 'A',
        dropoff: 'B',
        date: '2026-10-01',
        vehicleType: 'sedan',
        passengers: 2,
      });

      const res = await request(app)
        .patch(`/quotes/${created.body.quote._id}`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ status: 'quoted', quotedPrice: 120 });

      expect(res.status).toBe(200);
      expect(res.body.quote.status).toBe('quoted');
      expect(res.body.quote.quotedPrice).toBe(120);
    });

    it('never sends the price to the customer (staff follow up in person)', async () => {
      const created = await request(app).post('/quotes').send({
        customerName: 'Huda',
        customerContact: '+966500000001',
        pickup: 'Makkah',
        dropoff: 'Madinah',
        date: '2026-10-01',
        passengers: 40,
        language: 'ar',
      });
      const id = created.body.quote._id;
      const auth = { Authorization: `Bearer ${adminToken}` };

      await request(app).patch(`/quotes/${id}`).set(auth).send({ status: 'quoted', quotedPrice: 12500 });
      await request(app).patch(`/quotes/${id}`).set(auth).send({ staffNotes: 'Called them' });
      await request(app).patch(`/quotes/${id}`).set(auth).send({ quotedPrice: 13000 });

      const sent = await Message.countDocuments({ conversationId: created.body.conversationId });
      expect(sent).toBe(0);
      expect((await Quote.findById(id)).quotedPrice).toBe(13000);
    });

    it('returns 404, not 500, for a malformed id', async () => {
      const res = await request(app)
        .patch('/quotes/not-an-id')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ status: 'won' });
      expect(res.status).toBe(404);
    });

    it('stamps quotedAt when a quote is priced and clears an old follow-up reminder', async () => {
      const created = await request(app).post('/quotes').send({
        customerName: 'Ada',
        customerContact: 'ada@example.com',
        pickup: 'A',
        dropoff: 'B',
        date: '2026-10-01',
        passengers: 2,
      });
      const id = created.body.quote._id;
      await Quote.updateOne({ _id: id }, { followUpRemindedAt: new Date(0) });

      const res = await request(app)
        .patch(`/quotes/${id}`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ status: 'quoted', quotedPrice: 500 });
      expect(res.body.quote.quotedAt).toBeTruthy();
      expect(res.body.quote.followUpRemindedAt).toBeNull();
    });

    it('keeps staff notes when the customer edits their request', async () => {
      const created = await request(app).post('/quotes').send({
        customerName: 'Ada',
        customerContact: 'ada@example.com',
        pickup: 'A',
        dropoff: 'B',
        date: '2026-10-01',
        passengers: 2,
        notes: 'Customer note',
      });
      const id = created.body.quote._id;

      const patched = await request(app)
        .patch(`/quotes/${id}`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ staffNotes: 'Called, wants 2 buses' });
      expect(patched.body.quote.staffNotes).toBe('Called, wants 2 buses');
      expect(patched.body.quote.notes).toBe('Customer note');

      await request(app)
        .put(`/quotes/${id}`)
        .set('x-edit-token', created.body.editToken)
        .send({
          customerName: 'Ada',
          customerContact: 'ada@example.com',
          pickup: 'A',
          dropoff: 'C',
          date: '2026-10-01',
          passengers: 2,
          notes: 'Changed my mind',
        });
      const saved = await Quote.findById(id).lean();
      expect(saved.notes).toBe('Changed my mind');
      expect(saved.staffNotes).toBe('Called, wants 2 buses');
    });
  });
});
describe('PUT /quotes/:id (customer edit)', () => {
  let app;
  const body = {
    customerName: 'Ada Lovelace',
    customerContact: 'ada@example.com',
    pickup: 'Airport',
    dropoff: 'Downtown',
    date: '2026-10-01T10:00:00.000Z',
    passengers: 3,
  };

  beforeAll(async () => {
    process.env.JWT_SECRET = 'test-jwt-secret-for-jest';
    await startTestDb();
    app = createApp();
  });
  afterAll(stopTestDb);
  beforeEach(clearDb);

  it('edits with the token, marks editedAt and never leaks the token hash', async () => {
    const created = await request(app).post('/quotes').send(body);
    expect(created.body.editToken).toBeTruthy();
    expect(created.body.quote.editTokenHash).toBeUndefined();
    const id = created.body.quote._id;

    const res = await request(app)
      .put(`/quotes/${id}`)
      .set('x-edit-token', created.body.editToken)
      .send({ ...body, dropoff: 'Harbour', passengers: 5 });
    expect(res.status).toBe(200);
    expect(res.body.quote.dropoff).toBe('Harbour');
    expect(res.body.quote.editedAt).toBeTruthy();
    expect(res.body.quote.editTokenHash).toBeUndefined();
  });

  it('rejects a missing or wrong token and invalid data', async () => {
    const created = await request(app).post('/quotes').send(body);
    const id = created.body.quote._id;
    expect((await request(app).put(`/quotes/${id}`).send(body)).status).toBe(404);
    expect(
      (await request(app).put(`/quotes/${id}`).set('x-edit-token', 'nope').send(body)).status
    ).toBe(404);
    const bad = await request(app)
      .put(`/quotes/${id}`)
      .set('x-edit-token', created.body.editToken)
      .send({ ...body, passengers: 0 });
    expect(bad.status).toBe(400);
  });

  it('refuses edits once the quote is no longer new', async () => {
    const created = await request(app).post('/quotes').send(body);
    const id = created.body.quote._id;
    await Quote.updateOne({ _id: id }, { status: 'quoted' });
    const res = await request(app)
      .put(`/quotes/${id}`)
      .set('x-edit-token', created.body.editToken)
      .send(body);
    expect(res.status).toBe(409);
  });
});
