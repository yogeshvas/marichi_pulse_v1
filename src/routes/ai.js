import { Router } from 'express';
import { z } from 'zod';
import rateLimit from 'express-rate-limit';
import { optionalAuth } from '../middleware/auth.js';
import { wrap } from '../middleware/error.js';
import { futureDate, flightSearch } from '../schemas.js';
import { parseTripSmart, missingFields } from '../services/nlp.js';
import { chat, suggestionsFor } from '../services/assistant.js';
import { adviseFlight } from '../services/advisor.js';
import { planTrip } from '../services/planner.js';

export const ai = Router();
ai.use(rateLimit({ windowMs: 60 * 1000, limit: 40, standardHeaders: true, legacyHeaders: false }));
ai.use(optionalAuth);

const today = () => new Date().toISOString().slice(0, 10);
ai.post('/parse', wrap(async (req, res) => {
  const { text } = z.object({ text: z.string().min(2).max(400) }).parse(req.body);
  const p = await parseTripSmart(text, today());
  res.json({ parsed: p, missing: missingFields(p) });
}));
ai.post('/chat', wrap(async (req, res) => {
  const { message } = z.object({ message: z.string().min(1).max(500) }).parse(req.body);
  res.json(await chat(req.user, message));
}));
ai.get('/suggestions', wrap((req, res) => res.json({ suggestions: suggestionsFor(req.user) })));
ai.get('/advice', wrap(async (req, res) => {
  const q = flightSearch.parse({ ...req.query, returnDate: undefined });
  res.json(await adviseFlight(q, req.user));
}));
ai.post('/plan', wrap(async (req, res) => {
  const b = z.object({
    origin: z.string().length(3).transform((s) => s.toUpperCase()), destination: z.string().length(3).transform((s) => s.toUpperCase()),
    date: futureDate, nights: z.coerce.number().int().min(1).max(14).default(3), adults: z.coerce.number().int().min(1).max(8).default(2),
    budget: z.coerce.number().int().min(500).max(5000000).optional(),
  }).refine((v) => v.origin !== v.destination, { message: 'Origin and destination must differ', path: ['destination'] }).parse(req.body);
  res.json(await planTrip(req.user, b));
}));
