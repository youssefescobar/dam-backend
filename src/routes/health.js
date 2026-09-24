import { Router } from 'express';
import { getHealthReport } from '../services/health.js';

const router = Router();

/**
 * GET /health
 * GET /health?deep=1  — also pings configured LLM provider APIs (slower)
 */
router.get('/', async (req, res, next) => {
  try {
    const deep =
      req.query.deep === '1' ||
      req.query.deep === 'true' ||
      req.query.deep === 'yes';

    const report = await getHealthReport({ deep });
    const httpStatus = report.status === 'error' ? 503 : 200;
    res.status(httpStatus).json(report);
  } catch (err) {
    next(err);
  }
});

export default router;