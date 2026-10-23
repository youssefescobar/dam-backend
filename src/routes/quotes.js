import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import mongoose from 'mongoose';
import { z } from 'zod';
import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import { Quote } from '../models/Quote.js';
import { findOrUpsertCustomer } from '../models/Customer.js';
import { Conversation } from '../models/Conversation.js';
import { requireAuth } from '../middleware/auth.js';
import { clientRateKey } from '../middleware/clientKey.js';
import { samePhone } from '../utils/phone.js';
import { validateBody } from '../middleware/validate.js';
import { HttpError } from '../middleware/errorHandler.js';
import { notifyAdmins } from '../services/push.js';
import { getCompanySettings } from '../models/Settings.js';

/** Field length caps for the public quote form (generous; they only stop junk and abuse). */
const NAME = 120;
const PHONE = 40;
const WORD = 60;
const SHORT = 200;
const LONG = 4000;

const legSchema = z.object({
  from: z.string().trim().min(1, 'leg from is required').max(SHORT),
  to: z.string().trim().min(1, 'leg to is required').max(SHORT),
  date: z.string().trim().max(40).optional().default(''),
  time: z.string().trim().max(20).optional().default(''),
});

const createQuoteSchema = z.object({
  customerName: z.string().min(1, 'customerName is required').max(NAME),
  customerContact: z.string().min(1, 'customerContact is required').max(SHORT),
  customerEmail: z.string().email().max(SHORT).optional().or(z.literal('')),
  customerPhone: z.string().max(PHONE).optional(),
  pickup: z.string().min(1, 'pickup is required').max(SHORT),
  dropoff: z.string().min(1, 'dropoff is required').max(SHORT),
  date: z.coerce.date({ error: 'date is required' }),
  vehicleType: z.string().min(1).max(WORD).default('standard'),
  passengers: z.coerce.number().int().min(1, 'passengers must be at least 1').max(100000),
  notes: z.string().max(LONG).optional().default(''),
  channel: z.enum(['web', 'whatsapp', 'phone', 'other']).optional().default('web'),
  language: z.enum(['ar', 'en']).optional(),
  customerType: z
    .enum([
      'individual',
      'company',
      'government',
      'school',
      'hajj_mission',
      'umrah_campaigns',
      'tourism',
      'group',
      'corporate',
    ])
    .optional(),
  organization: z.string().max(SHORT).optional().default(''),
  email: z.string().email().max(SHORT).optional().or(z.literal('')),
  serviceType: z.string().max(WORD).optional().default(''),
  originCity: z.string().max(SHORT).optional().default(''),
  destinationCity: z.string().max(SHORT).optional().default(''),
  returnDatetime: z.coerce.date().optional().nullable(),
  tripType: z.string().max(WORD).optional().default(''),
  busCount: z.coerce.number().int().min(1).max(10000).optional().nullable(),
  busClass: z.string().max(WORD).optional().default(''),
  luggageNotes: z.string().max(LONG).optional().default(''),
  accessibilityNeeds: z.string().max(LONG).optional().default(''),
  specialRequirements: z.string().max(LONG).optional().default(''),
  stops: z.string().max(LONG).optional().default(''),
  legs: z.array(legSchema).max(10).optional().default([]),
  departureTime: z.string().max(WORD).optional().default(''),
  waitingHours: z.coerce.number().min(0).max(10000).optional().nullable(),
  needsSupervisors: z.boolean().optional().default(false),
  needsTracking: z.boolean().optional().default(false),
  needsBranding: z.boolean().optional().default(false),
  needsAirportReception: z.boolean().optional().default(false),
  preferredContactChannel: z.enum(['phone', 'whatsapp', 'email', 'web']).optional(),
  consent: z.boolean().optional().default(false),
  priority: z.enum(['normal', 'high', 'urgent']).optional().default('normal'),
});

const patchQuoteSchema = z.object({
  status: z.enum(['new', 'quoted', 'won', 'lost']).optional(),
  quotedPrice: z.number().positive().optional().nullable(),
  notes: z.string().optional(),
  staffNotes: z.string().max(4000).optional(),
  assignedDepartment: z
    .enum(['', 'sales', 'hajj', 'corporate', 'operations', 'support'])
    .optional(),
  priority: z.enum(['normal', 'high', 'urgent']).optional(),
});

const QUOTES_LIST_MAX = 1000;

const hashToken = (t) => createHash('sha256').update(String(t)).digest('hex');

/** Customer-editable fields, shared by create and edit so both stay in sync. */
const quoteFields = (data) => ({
  pickup: data.pickup,
  dropoff: data.dropoff,
  date: data.date,
  vehicleType: data.vehicleType || data.busClass || 'standard',
  passengers: data.passengers,
  notes: data.notes,
  customerName: data.customerName,
  customerContact: data.customerContact,
  language: data.language || '',
  customerType: data.customerType || data.tripType || '',
  organization: data.organization || '',
  email: data.email || data.customerEmail || '',
  serviceType: data.serviceType || '',
  originCity: data.originCity || '',
  destinationCity: data.destinationCity || '',
  returnDatetime: data.returnDatetime || null,
  tripType: data.tripType || data.customerType || '',
  busCount: data.busCount ?? null,
  busClass: data.busClass || data.vehicleType || '',
  luggageNotes: data.luggageNotes || '',
  accessibilityNeeds: data.accessibilityNeeds || '',
  specialRequirements: data.specialRequirements || '',
  stops: data.stops || '',
  legs: data.legs || [],
  departureTime: data.departureTime || '',
  waitingHours: data.waitingHours ?? null,
  needsSupervisors: Boolean(data.needsSupervisors),
  needsTracking: Boolean(data.needsTracking),
  needsBranding: Boolean(data.needsBranding),
  needsAirportReception: Boolean(data.needsAirportReception),
  preferredContactChannel: data.preferredContactChannel || '',
  consent: Boolean(data.consent),
});

const router = Router();

/**
 * Spam guard for the public quote form. The website submits from its own server, so every
 * visitor shares that server's IP: the per-phone limit is the real one (5 per 10 minutes),
 * and the per-IP limit is only a high ceiling against scripts that rotate phone numbers.
 */
const quoteLimit = (limit, keyGenerator) =>
  rateLimit({
    windowMs: 10 * 60 * 1000,
    limit,
    standardHeaders: true,
    legacyHeaders: false,
    validate: { xForwardedForHeader: false },
    keyGenerator,
    message: { error: 'Too many requests, please try again in a few minutes' },
  });
const quoteIpLimiter = quoteLimit(() => Number(process.env.QUOTE_MAX_PER_IP) || 60, clientRateKey);
const quotePhoneLimiter = quoteLimit(
  () => Number(process.env.QUOTE_MAX_PER_PHONE) || 5,
  (req) => {
    const b = req.body || {};
    const phone = String(b.customerPhone || b.customerContact || '').replace(/\D/g, '').slice(-9);
    return phone ? `quote-phone:${phone}` : clientRateKey(req);
  }
);

router.post('/', quoteIpLimiter, validateBody(createQuoteSchema), quotePhoneLimiter, async (req, res, next) => {
  try {
    const data = req.body;
    const contact = data.customerContact.trim();
    const looksEmail = contact.includes('@');
    const email = (data.email || data.customerEmail || (looksEmail ? contact : '')).toLowerCase();
    // The phone is the customer's identity. An email-only request is keyed by that email,
    // so separate email-only customers never merge into one record.
    const phone = data.customerPhone?.trim() || contact;

    const customer = await findOrUpsertCustomer({
      name: data.customerName,
      email,
      phone,
      channel: data.channel,
    });

    const conversation = await Conversation.create({
      customerId: customer._id,
      status: 'ai_handling',
      lastActivityAt: new Date(),
    });

    const assignedDepartment =
      (data.customerType === 'hajj_mission' || data.customerType === 'umrah_campaigns')
        ? 'hajj'
        : data.customerType === 'company' ||
            data.customerType === 'corporate' ||
            data.customerType === 'government'
          ? 'corporate'
          : 'sales';

    const editToken = randomBytes(24).toString('hex');
    const quote = await Quote.create({
      customerId: customer._id,
      conversationId: conversation._id,
      ...quoteFields(data),
      // Priority is staff-owned after this; a customer edit (PUT) never touches it.
      priority: data.priority || 'normal',
      assignedDepartment,
      editTokenHash: hashToken(editToken),
      status: 'new',
    });

    const leadId = `DM-${String(quote._id).slice(-8).toUpperCase()}`;
    quote.leadId = leadId;
    await quote.save();

    let quoteSlaHours = 24;
    try {
      const settings = await getCompanySettings();
      if (settings?.quoteSlaHours) quoteSlaHours = settings.quoteSlaHours;
    } catch {
      /* optional */
    }

    notifyAdmins({
      title: 'New quote',
      body: `${leadId} · ${data.customerName} · ${data.pickup} → ${data.dropoff}`,
      data: {
        type: 'quote',
        quoteId: quote._id.toString(),
        leadId,
        url: '/quotes',
      },
    }).catch(() => {});

    const { emitToAdminQueue } = await import('../sockets/chat.js').catch(() => ({
      emitToAdminQueue: null,
    }));
    if (typeof emitToAdminQueue === 'function') {
      emitToAdminQueue('quote:new', { quote });
    }

    res.status(201).json({
      quote,
      conversationId: conversation._id,
      leadId,
      quoteSlaHours,
      editToken,
    });
  } catch (err) {
    next(err);
  }
});

/** Per lead ID, so nobody can guess phone numbers for one request. */
const trackLeadLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 10,
  standardHeaders: true,
  legacyHeaders: false,
  validate: { xForwardedForHeader: false },
  keyGenerator: (req) => `lead:${String(req.query.leadId || '').trim().toUpperCase()}`,
});

const trackSchema = z.object({
  leadId: z.string().trim().regex(/^DM-[A-Z0-9]{4,20}$/i, 'leadId looks like DM-1A2B3C4D'),
  phone: z.string().trim().min(6, 'phone is required').max(40),
});

/**
 * Public status lookup for the website's "Track my request" page.
 * Needs the lead ID plus the phone it was sent with; same 404 for either mismatch.
 */
router.get('/track', trackLeadLimiter, async (req, res, next) => {
  try {
    const parsed = trackSchema.safeParse(req.query);
    if (!parsed.success) throw new HttpError(400, 'leadId and phone are required');
    const { leadId, phone } = parsed.data;

    const quote = await Quote.findOne({ leadId: leadId.toUpperCase() }).lean();
    if (!quote || !samePhone(phone, quote.customerContact)) {
      throw new HttpError(404, 'Request not found');
    }

    res.json({
      tracking: {
        leadId: quote.leadId,
        status: quote.status,
        pickup: quote.pickup,
        dropoff: quote.dropoff,
        date: quote.date,
        passengers: quote.passengers,
        busCount: quote.busCount,
        submittedAt: quote.createdAt,
        updatedAt: quote.updatedAt,
        editable: quote.status === 'new',
      },
    });
  } catch (err) {
    next(err);
  }
});

router.get('/', requireAuth, async (req, res, next) => {
  try {
    const filter = {};
    if (req.query.status) filter.status = req.query.status;
    if (req.query.serviceType) filter.serviceType = String(req.query.serviceType);
    if (req.query.customerType) filter.customerType = String(req.query.customerType);
    if (req.query.assignedDepartment) {
      filter.assignedDepartment = String(req.query.assignedDepartment);
    }
    // Newest first, capped so the admin page stays fast as quotes pile up (?limit= up to 1000).
    const limit = Math.min(Math.max(Number(req.query.limit) || QUOTES_LIST_MAX, 1), QUOTES_LIST_MAX);
    const quotes = await Quote.find(filter).sort({ createdAt: -1 }).limit(limit).lean();
    res.json({ quotes });
  } catch (err) {
    next(err);
  }
});

router.patch('/:id', requireAuth, validateBody(patchQuoteSchema), async (req, res, next) => {
  try {
    const quote = await Quote.findById(req.params.id);
    if (!quote) {
      throw new HttpError(404, 'Quote not found');
    }

    if (req.body.status !== undefined) {
      if (req.body.status === 'quoted' && quote.status !== 'quoted') {
        quote.quotedAt = new Date();
        quote.followUpRemindedAt = null;
      }
      quote.status = req.body.status;
    }
    if (req.body.quotedPrice !== undefined) quote.quotedPrice = req.body.quotedPrice;
    if (req.body.notes !== undefined) quote.notes = req.body.notes;
    if (req.body.staffNotes !== undefined) quote.staffNotes = req.body.staffNotes;
    if (req.body.assignedDepartment !== undefined) {
      quote.assignedDepartment = req.body.assignedDepartment;
    }
    if (req.body.priority !== undefined) quote.priority = req.body.priority;

    await quote.save();

    res.json({ quote });
  } catch (err) {
    next(err);
  }
});

router.put('/:id', validateBody(createQuoteSchema), async (req, res, next) => {
  try {
    const token = req.get('x-edit-token') || '';
    const quote = mongoose.isValidObjectId(req.params.id)
      ? await Quote.findById(req.params.id).select('+editTokenHash')
      : null;
    const given = Buffer.from(hashToken(token));
    const want = Buffer.from(quote?.editTokenHash || '');
    // Same 404 for unknown id and bad token so ids cannot be probed.
    if (!quote || !token || given.length !== want.length || !timingSafeEqual(given, want)) {
      throw new HttpError(404, 'Quote not found');
    }
    if (quote.status !== 'new') {
      throw new HttpError(409, 'Quote is already being processed and can no longer be edited');
    }

    const data = req.body;
    quote.set({
      ...quoteFields(data),
      editedAt: new Date(),
    });
    await quote.save();

    notifyAdmins({
      title: 'Quote edited',
      body: `${quote.leadId} · ${data.customerName} · ${data.pickup} → ${data.dropoff}`,
      data: { type: 'quote', quoteId: quote._id.toString(), leadId: quote.leadId, url: '/quotes' },
    }).catch(() => {});

    res.json({ quote, leadId: quote.leadId });
  } catch (err) {
    next(err);
  }
});

export default router;
