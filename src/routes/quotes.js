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

const createQuoteSchema = z.object({
  customerName: z.string().min(1, 'customerName is required'),
  customerContact: z.string().min(1, 'customerContact is required'),
  customerEmail: z.string().email().optional(),
  customerPhone: z.string().optional(),
  pickup: z.string().min(1, 'pickup is required'),
  dropoff: z.string().min(1, 'dropoff is required'),
  date: z.coerce.date({ error: 'date is required' }),
  vehicleType: z.string().min(1, 'vehicleType is required'),
  passengers: z.coerce.number().int().min(1, 'passengers must be at least 1'),
  notes: z.string().optional().default(''),
  channel: z.enum(['web', 'whatsapp', 'phone', 'other']).optional().default('web'),
});

const patchQuoteSchema = z.object({
  status: z.enum(['new', 'quoted', 'won', 'lost']).optional(),
  quotedPrice: z.number().positive().optional().nullable(),
  notes: z.string().optional(),
});

const router = Router();

router.post('/', validateBody(createQuoteSchema), async (req, res, next) => {
  try {
    const data = req.body;
    const contact = data.customerContact.trim();
    const looksEmail = contact.includes('@');
    const email = (data.customerEmail || (looksEmail ? contact : `${contact.replace(/\W/g, '') || 'quote'}@quote.local`)).toLowerCase();
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

    const quote = await Quote.create({
      customerId: customer._id,
      conversationId: conversation._id,
      pickup: data.pickup,
      dropoff: data.dropoff,
      date: data.date,
      vehicleType: data.vehicleType,
      passengers: data.passengers,
      notes: data.notes,
      customerName: data.customerName,
      customerContact: data.customerContact,
      status: 'new',
    });

    // Fire-and-forget push (no-op if VAPID not configured / Phase 5)
    notifyAdmins({
      title: 'New quote request',
      body: `${data.customerName}: ${data.pickup} → ${data.dropoff}`,
      data: {
        type: 'quote',
        quoteId: quote._id.toString(),
        url: '/quotes',
      },
    }).catch(() => {});

    // Notify socket layer if registered
    const { emitToAdminQueue } = await import('../sockets/chat.js').catch(() => ({
      emitToAdminQueue: null,
    }));
    if (typeof emitToAdminQueue === 'function') {
      emitToAdminQueue('quote:new', { quote });
    }

    res.status(201).json({ quote, conversationId: conversation._id });
  } catch (err) {
    next(err);
  }
});

router.get('/', requireAuth, async (req, res, next) => {
  try {
    const filter = {};
    if (req.query.status) {
      filter.status = req.query.status;
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

    await quote.save();

    // Phase 6: when marked quoted with a price, post into conversation
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