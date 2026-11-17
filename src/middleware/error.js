import { ZodError } from 'zod';
import { AppError } from '../errors.js';

export const notFound = (_req, _res, next) => next(new AppError(404, 'NOT_FOUND', 'Not found'));

export function errorHandler(err, _req, res, _next) {
  if (err instanceof ZodError) {
    const fields = {};
    for (const i of err.issues) fields[i.path.join('.')] = i.message;
    return res.status(400).json({ error: { code: 'VALIDATION', message: 'Please check the highlighted fields.', fields } });
  }
  if (err instanceof AppError) {
    return res.status(err.status).json({ error: { code: err.code, message: err.message, details: err.code === 'PRICE_CHANGED' ? err.details : undefined } });
  }
  if (err?.type === 'entity.parse.failed') return res.status(400).json({ error: { code: 'BAD_JSON', message: 'Request body is not valid JSON.' } });
  console.error(err);
  res.status(500).json({ error: { code: 'INTERNAL', message: 'Something went wrong on our side. Please try again.' } });
}

export const wrap = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);
