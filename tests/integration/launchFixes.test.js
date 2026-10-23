import fs from 'node:fs';
import { describe, it, expect, beforeAll, afterAll, beforeEach } from '@jest/globals';
import request from 'supertest';
import bcrypt from 'bcryptjs';
import { createApp } from '../../src/app.js';
import { startTestDb, stopTestDb, clearDb } from '../helpers/db.js';
import { Admin } from '../../src/models/Admin.js';
import { Customer } from '../../src/models/Customer.js';
import { KnowledgeBaseEntry } from '../../src/models/KnowledgeBaseEntry.js';
import { parseKbCsv } from '../../src/utils/csv.js';
import { importKnowledgeEntries } from '../../src/services/kbImport.js';
import { loadFaqEntries } from '../../src/services/faqPrompt.js';

const quote = (over = {}) => ({
  customerName: 'Sara',
  customerContact: '+966501112233',
  customerPhone: '+966501112233',
  pickup: 'Jeddah',
  dropoff: 'Makkah',
  date: '2026-12-01',
  passengers: 30,
  ...over,
});

describe('launch fixes', () => {
  let app;
  let token;

  beforeAll(async () => {
    delete process.env.QUOTE_MAX_PER_PHONE;
    process.env.JWT_SECRET = 'test-jwt-secret-for-jest';
    await startTestDb();
    app = createApp();
  });

  afterAll(stopTestDb);

  beforeEach(async () => {
    await clearDb();
    await Admin.create({ name: 'A', email: 'a@test.com', passwordHash: await bcrypt.hash('pw', 4) });
    token = (await request(app).post('/auth/login').send({ email: 'a@test.com', password: 'pw' })).body.token;
  });

  describe('FAQ loading', () => {
    it('gives the bot every seeded row in both languages', async () => {
      for (const file of ['data/kb-info-full.csv', 'data/kb-info-full.ar.csv']) {
        await importKnowledgeEntries(parseKbCsv(fs.readFileSync(file, 'utf8')));
      }
      const total = await KnowledgeBaseEntry.countDocuments();
      const entries = await loadFaqEntries();
      expect(entries).toHaveLength(total);
      expect(entries.some((e) => e.sourceId === 'Q160' && e.locale === 'ar')).toBe(true);
    });

    it('sees admin KB edits straight away despite the cache', async () => {
      await KnowledgeBaseEntry.create({ title: 'Hours', content: 'Nine to five' });
      expect(await loadFaqEntries()).toHaveLength(1);

      const created = await request(app)
        .post('/kb')
        .set('Authorization', `Bearer ${token}`)
        .send({ title: 'Wifi', content: 'Yes, on most buses' });
      expect((await loadFaqEntries()).map((e) => e.title)).toContain('Wifi');

      await request(app).delete(`/kb/${created.body.entry._id}`).set('Authorization', `Bearer ${token}`);
      expect((await loadFaqEntries()).map((e) => e.title)).not.toContain('Wifi');
    });
  });

  describe('customer identity is the phone', () => {
    it('does not let a new chat with someone else\'s email take over their record', async () => {
      const victim = await request(app).post('/chat/session').send({ name: 'Victim', email: 'v@x.com', phone: '+966511111111' });
      await request(app).post('/chat/session').send({ name: 'Other', email: 'v@x.com', phone: '+966599999999' });

      const original = await Customer.findById(victim.body.customer.id).lean();
      expect(original.phone).toBe('+966511111111');
      expect(original.name).toBe('Victim');
      expect(await Customer.countDocuments()).toBe(2);

      // The other phone can't read the victim's chat.
      const history = await request(app)
        .get('/chat/history')
        .query({ conversationId: victim.body.conversationId, phone: '+966599999999' });
      expect(history.status).toBe(404);
    });

    it('reuses the record for the same phone and refreshes the name', async () => {
      await request(app).post('/chat/session').send({ name: 'Sara', phone: '+966511111111' });
      await request(app).post('/chat/session').send({ name: 'Sara A.', email: 's@x.com', phone: '+966511111111' });
      const all = await Customer.find().lean();
      expect(all).toHaveLength(1);
      expect(all[0]).toMatchObject({ name: 'Sara A.', email: 's@x.com', phone: '+966511111111' });
    });

    it('keeps email-only quote requests as separate customers', async () => {
      await request(app).post('/quotes').send(quote({ customerName: 'A', customerContact: 'a@x.com', customerPhone: undefined }));
      await request(app).post('/quotes').send(quote({ customerName: 'B', customerContact: 'b@x.com', customerPhone: undefined }));
      const names = (await Customer.find().lean()).map((c) => c.name).sort();
      expect(names).toEqual(['A', 'B']);
    });

    it('does not replace a real email with a made-up one when a quote has no email', async () => {
      await request(app).post('/chat/session').send({ name: 'Sara', email: 'sara@x.com', phone: '+966501112233' });
      await request(app).post('/quotes').send(quote());
      const [customer] = await Customer.find().lean();
      expect(customer.email).toBe('sara@x.com');
    });
  });

  describe('quote form limits', () => {
    it('rejects oversized fields', async () => {
      const res = await request(app).post('/quotes').send(quote({ customerName: 'x'.repeat(5000) }));
      expect(res.status).toBe(400);
      expect(res.body.fields.customerName).toBeTruthy();
    });

    it('allows 5 requests per phone in 10 minutes, then says to wait', async () => {
      for (let i = 0; i < 5; i += 1) {
        const ok = await request(app).post('/quotes').send(quote({ customerPhone: '+966507770000', customerContact: '+966507770000' }));
        expect(ok.status).toBe(201);
      }
      const blocked = await request(app).post('/quotes').send(quote({ customerPhone: '+966507770000', customerContact: '0507770000' }));
      expect(blocked.status).toBe(429);
      expect(blocked.body.error).toMatch(/too many/i);

      // A different customer on the same website server is not affected.
      const other = await request(app).post('/quotes').send(quote({ customerPhone: '+966508880000', customerContact: '+966508880000' }));
      expect(other.status).toBe(201);
    });
  });
});
