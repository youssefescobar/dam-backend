import { z } from 'zod';
import { Router } from 'express';
import { getCompanySettings } from '../models/Settings.js';
import { requireAuth } from '../middleware/auth.js';
import { validateBody } from '../middleware/validate.js';

const patchSchema = z.object({
  legalNameAr: z.string().optional(),
  legalNameEn: z.string().optional(),
  email: z.string().email().optional().or(z.literal('')),
  phones: z.array(z.string()).optional(),
  whatsappNumber: z.string().optional(),
  addressAr: z.string().optional(),
  addressEn: z.string().optional(),
  workingHoursAr: z.string().optional(),
  workingHoursEn: z.string().optional(),
  fleetSizeNote: z.string().optional(),
  baggagePolicy: z.string().optional(),
  cancellationPolicy: z.string().optional(),
  childFareNote: z.string().optional(),
  quoteSlaHours: z.coerce.number().int().min(1).max(720).optional(),
  complaintSlaHours: z.coerce.number().int().min(1).max(720).optional(),
  botGreetingEn: z.string().optional(),
  botGreetingAr: z.string().optional(),
  botClosingEn: z.string().optional(),
  botClosingAr: z.string().optional(),
});

const router = Router();

/** Public read — marketing site / bot can fetch contact & hours */
router.get('/public', async (_req, res, next) => {
  try {
    const doc = await getCompanySettings();
    res.json({
      settings: {
        legalNameAr: doc.legalNameAr,
        legalNameEn: doc.legalNameEn,
        email: doc.email,
        phones: doc.phones,
        whatsappNumber: doc.whatsappNumber,
        addressAr: doc.addressAr,
        addressEn: doc.addressEn,
        workingHoursAr: doc.workingHoursAr,
        workingHoursEn: doc.workingHoursEn,
        quoteSlaHours: doc.quoteSlaHours,
        botGreetingEn: doc.botGreetingEn,
        botGreetingAr: doc.botGreetingAr,
      },
    });
  } catch (err) {
    next(err);
  }
});

router.use(requireAuth);

router.get('/', async (_req, res, next) => {
  try {
    const doc = await getCompanySettings();
    res.json({ settings: doc });
  } catch (err) {
    next(err);
  }
});

router.patch('/', validateBody(patchSchema), async (req, res, next) => {
  try {
    const doc = await getCompanySettings();
    const fields = Object.keys(req.body);
    for (const key of fields) {
      if (req.body[key] !== undefined) {
        doc[key] = req.body[key];
      }
    }
    await doc.save();
    res.json({ settings: doc });
  } catch (err) {
    next(err);
  }
});

export default router;
