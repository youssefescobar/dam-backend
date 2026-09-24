import { describe, it, expect, beforeAll, afterAll, beforeEach } from '@jest/globals';
import request from 'supertest';
import bcrypt from 'bcryptjs';
import { createApp } from '../../src/app.js';
import { startTestDb, stopTestDb, clearDb } from '../helpers/db.js';
import { Admin } from '../../src/models/Admin.js';
import { Quote } from '../../src/models/Quote.js';
import { KnowledgeBaseEntry } from '../../src/models/KnowledgeBaseEntry.js';

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
  });
});