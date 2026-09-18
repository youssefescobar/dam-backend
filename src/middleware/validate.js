import { HttpError } from './errorHandler.js';

/**
 * Validate req.body with a Zod schema.
 * @param {import('zod').ZodType} schema
 */
export function validateBody(schema) {
  return (req, _res, next) => {
    const result = schema.safeParse(req.body);
    if (!result.success) {
      const fields = {};
      for (const issue of result.error.issues) {
        const key = issue.path.join('.') || '_root';
        if (!fields[key]) fields[key] = issue.message;
      }
      return next(new HttpError(400, 'Validation failed', fields));
    }
    req.body = result.data;
    next();
  };
}