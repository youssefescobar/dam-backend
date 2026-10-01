import { z } from 'zod';
import { Router } from 'express';
import { Report } from '../models/Report.js';
import { requireAuth } from '../middleware/auth.js';
import { validateBody } from '../middleware/validate.js';
import { HttpError } from '../middleware/errorHandler.js';

const patchReportSchema = z.object({
  status: z.enum(['new', 'in_progress', 'resolved']),
});

const router = Router();

router.get('/', requireAuth, async (req, res, next) => {
  try {
    const filter = {};
    if (req.query.type) filter.type = String(req.query.type);
    if (req.query.status) filter.status = String(req.query.status);
    const reports = await Report.find(filter).sort({ createdAt: -1 }).limit(500).lean();
    res.json({ reports });
  } catch (err) {
    next(err);
  }
});

router.patch('/:id', requireAuth, validateBody(patchReportSchema), async (req, res, next) => {
  try {
    const report = await Report.findById(req.params.id);
    if (!report) throw new HttpError(404, 'Report not found');
    report.status = req.body.status;
    await report.save();
    res.json({ report });
  } catch (err) {
    next(err);
  }
});

export default router;
