import { describe, it, expect, beforeAll, afterAll, beforeEach } from '@jest/globals';
import request from 'supertest';
import { createApp } from '../../src/app.js';
import { startTestDb, stopTestDb, clearDb } from '../helpers/db.js';
import { Quote } from '../../src/models/Quote.js';

describe('GET /quotes/track', () => {
  let app;
  let leadId;
  let id;

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
    const created = await request(app).post('/quotes').send({
      customerName: 'Huda',
      customerContact: '+966 50 123 4567',
      pickup: 'Makkah',
      dropoff: 'Madinah',
      date: '2026-11-01',
      passengers: 40,
    });
    leadId = created.body.leadId;
    id = created.body.quote._id;
  });

  it('returns status for the right lead ID and phone, in any phone format', async () => {
    const res = await request(app).get('/quotes/track').query({ leadId: leadId.toLowerCase(), phone: '0501234567' });
    expect(res.status).toBe(200);
    expect(res.body.tracking).toMatchObject({ leadId, status: 'new', quotedPrice: null, editable: true });
    expect(res.body.tracking.customerContact).toBeUndefined();
  });

  it('shows the price only once quoted', async () => {
    await Quote.updateOne({ _id: id }, { status: 'quoted', quotedPrice: 9000 });
    const res = await request(app).get('/quotes/track').query({ leadId, phone: '+966501234567' });
    expect(res.body.tracking).toMatchObject({ status: 'quoted', quotedPrice: 9000, currency: 'SAR', editable: false });
  });

  it('gives the same 404 for a wrong phone or unknown lead', async () => {
    const wrong = await request(app).get('/quotes/track').query({ leadId, phone: '+966509999999' });
    const unknown = await request(app).get('/quotes/track').query({ leadId: 'DM-00000000', phone: '+966501234567' });
    expect(wrong.status).toBe(404);
    expect(unknown.status).toBe(404);
    expect(wrong.body).toEqual(unknown.body);
  });

  it('rejects malformed input', async () => {
    const res = await request(app).get('/quotes/track').query({ leadId: 'x', phone: '1' });
    expect(res.status).toBe(400);
  });

  it('rate-limits guesses per lead ID', async () => {
    let last;
    for (let i = 0; i < 11; i += 1) {
      last = await request(app).get('/quotes/track').query({ leadId: 'DM-RATELIMT', phone: `+96650000000${i}` });
    }
    expect(last.status).toBe(429);
  });
});
