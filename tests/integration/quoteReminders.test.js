import { describe, it, expect, beforeAll, afterAll, beforeEach } from '@jest/globals';
import mongoose from 'mongoose';
import { startTestDb, stopTestDb, clearDb } from '../helpers/db.js';
import { Quote } from '../../src/models/Quote.js';
import { Settings } from '../../src/models/Settings.js';
import { sweepQuoteReminders } from '../../src/services/quoteReminders.js';
import { setPushImplementation } from '../../src/services/push.js';

const HOUR = 60 * 60 * 1000;

const makeQuote = (overrides = {}) =>
  Quote.create({
    customerId: new mongoose.Types.ObjectId(),
    customerName: 'Huda',
    customerContact: '+966500000001',
    pickup: 'Makkah',
    dropoff: 'Madinah',
    date: new Date('2026-11-01'),
    vehicleType: 'vip',
    passengers: 40,
    leadId: 'DM-TEST0001',
    ...overrides,
  });

/** Backdate createdAt (mongoose timestamps ignore it on create). */
const age = (quote, ms) =>
  Quote.collection.updateOne({ _id: quote._id }, { $set: { createdAt: new Date(Date.now() - ms) } });

describe('Quote follow-up reminders', () => {
  let pushes;

  beforeAll(async () => {
    await startTestDb();
  });

  afterAll(async () => {
    setPushImplementation(null);
    await stopTestDb();
  });

  beforeEach(async () => {
    await clearDb();
    pushes = [];
    setPushImplementation(async (payload) => {
      pushes.push(payload);
    });
  });

  it('reminds once when a new quote passes the reply SLA', async () => {
    const late = await makeQuote();
    await age(late, 25 * HOUR);
    const fresh = await makeQuote({ leadId: 'DM-FRESH' });
    await age(fresh, 2 * HOUR);

    expect(await sweepQuoteReminders()).toEqual({ overdue: 1, followUp: 0 });
    expect(pushes).toHaveLength(1);
    expect(pushes[0].data).toMatchObject({ kind: 'overdue', quoteId: late._id.toString() });
    expect(pushes[0].data.url).toBe(`/quotes?q=${late._id}`);

    expect(await sweepQuoteReminders()).toEqual({ overdue: 0, followUp: 0 });
    expect((await Quote.findById(late._id)).overdueRemindedAt).toBeInstanceOf(Date);
  });

  it('uses the SLA from settings', async () => {
    await Settings.create({ _id: 'company', quoteSlaHours: 48 });
    const q = await makeQuote();
    await age(q, 25 * HOUR);
    expect((await sweepQuoteReminders()).overdue).toBe(0);
  });

  it('reminds to follow up on a quoted lead with no decision', async () => {
    await makeQuote({ status: 'quoted', quotedPrice: 9000, quotedAt: new Date(Date.now() - 4 * 24 * HOUR) });
    await makeQuote({ status: 'quoted', quotedPrice: 9000, quotedAt: new Date(Date.now() - 1 * 24 * HOUR) });
    await makeQuote({ status: 'won', quotedPrice: 9000, quotedAt: new Date(Date.now() - 9 * 24 * HOUR) });

    expect(await sweepQuoteReminders()).toEqual({ overdue: 0, followUp: 1 });
    expect(pushes[0].data.kind).toBe('follow_up');
  });

  it('skips follow-ups when they are turned off', async () => {
    await Settings.create({ _id: 'company', quoteFollowUpDays: 0 });
    await makeQuote({ status: 'quoted', quotedPrice: 9000, quotedAt: new Date(Date.now() - 30 * 24 * HOUR) });
    expect((await sweepQuoteReminders()).followUp).toBe(0);
  });
});
