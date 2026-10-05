import { z } from 'zod';
import { Router } from 'express';
import { Quote } from '../models/Quote.js';
import { findOrUpsertCustomer } from '../models/Customer.js';
import { Conversation } from '../models/Conversation.js';
import { Message } from '../models/Message.js';
import { requireAuth } from '../middleware/auth.js';
import { validateBody } from '../middleware/validate.js';
import { HttpError } from '../middleware/errorHandler.js';
import { notifyAdmins } from '../services/push.js';
import { getCompanySettings } from '../models/Settings.js';

const createQuoteSchema = z.object({
  customerName: z.string().min(1, 'customerName is required'),
  customerContact: z.string().min(1, 'customerContact is required'),
  customerEmail: z.string().email().optional().or(z.literal('')),
  customerPhone: z.string().optional(),
  pickup: z.string().min(1, 'pickup is required'),
  dropoff: z.string().min(1, 'dropoff is required'),
  date: z.coerce.date({ error: 'date is required' }),
  vehicleType: z.string().min(1).default('standard'),
  passengers: z.coerce.number().int().min(1, 'passengers must be at least 1'),
  notes: z.string().optional().default(''),
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
  organization: z.string().optional().default(''),
  email: z.string().email().optional().or(z.literal('')),
  serviceType: z.string().optional().default(''),
  originCity: z.string().optional().default(''),
  destinationCity: z.string().optional().default(''),
  returnDatetime: z.coerce.date().optional().nullable(),
  tripType: z.string().optional().default(''),
  busCount: z.coerce.number().int().min(1).optional().nullable(),
  busClass: z.string().optional().default(''),
  luggageNotes: z.string().optional().default(''),
  accessibilityNeeds: z.string().optional().default(''),
  specialRequirements: z.string().optional().default(''),
  stops: z.string().optional().default(''),
  departureTime: z.string().optional().default(''),
  waitingHours: z.coerce.number().min(0).optional().nullable(),
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
  assignedDepartment: z
    .enum(['', 'sales', 'hajj', 'corporate', 'operations', 'support'])
    .optional(),
  priority: z.enum(['normal', 'high', 'urgent']).optional(),
});

const router = Router();

router.post('/', validateBody(createQuoteSchema), async (req, res, next) => {
  try {
    const data = req.body;
    const contact = data.customerContact.trim();
    const looksEmail = contact.includes('@');
    const email = (
      data.email ||
      data.customerEmail ||
      (looksEmail ? contact : `${contact.replace(/\W/g, '') || 'quote'}@quote.local`)
    ).toLowerCase();
    const phone = data.customerPhone || (!looksEmail ? contact : '+10000000000');

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

    const quote = await Quote.create({
      customerId: customer._id,
      conversationId: conversation._id,
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
      departureTime: data.departureTime || '',
      waitingHours: data.waitingHours ?? null,
      needsSupervisors: Boolean(data.needsSupervisors),
      needsTracking: Boolean(data.needsTracking),
      needsBranding: Boolean(data.needsBranding),
      needsAirportReception: Boolean(data.needsAirportReception),
      preferredContactChannel: data.preferredContactChannel || '',
      consent: Boolean(data.consent),
      priority: data.priority || 'normal',
      assignedDepartment,
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
    const quotes = await Quote.find(filter).sort({ createdAt: -1 }).lean();
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

    if (req.body.status !== undefined) quote.status = req.body.status;
    if (req.body.quotedPrice !== undefined) quote.quotedPrice = req.body.quotedPrice;
    if (req.body.notes !== undefined) quote.notes = req.body.notes;
    if (req.body.assignedDepartment !== undefined) {
      quote.assignedDepartment = req.body.assignedDepartment;
    }
    if (req.body.priority !== undefined) quote.priority = req.body.priority;

    await quote.save();

    if (quote.status === 'quoted' && quote.quotedPrice != null && quote.conversationId) {
      await Message.create({
        conversationId: quote.conversationId,
        sender: 'system',
        text: `Your quote has been priced at ${quote.quotedPrice}. Our team will follow up if you have questions.`,
      });

      const { emitToConversation } = await import('../sockets/chat.js').catch(() => ({
        emitToConversation: null,
      }));
      if (typeof emitToConversation === 'function') {
        emitToConversation(quote.conversationId.toString(), 'message:new', {
          sender: 'system',
          text: `Your quote has been priced at ${quote.quotedPrice}.`,
        });
      }
    }

    res.json({ quote });
  } catch (err) {
    next(err);
  }
});

export default router;
