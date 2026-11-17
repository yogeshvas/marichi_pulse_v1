import { Router } from 'express';
import { z } from 'zod';
import { db } from '../db.js';
import { AppError } from '../errors.js';
import { requireAuth, publicUser } from '../middleware/auth.js';
import { pointsBalance, lifetimePoints, tierOf } from '../services/rewards.js';
import { wrap } from '../middleware/error.js';

export const account = Router();
account.use(requireAuth);

account.put('/profile', wrap((req, res) => {
  const b = z.object({ name: z.string().trim().min(2).max(60), phone: z.string().regex(/^\+?\d{8,15}$/, 'Enter a valid phone number').optional().or(z.literal('')) }).parse(req.body);
  db.prepare('UPDATE users SET name = ?, phone = ? WHERE id = ?').run(b.name, b.phone || null, req.user.id);
  res.json({ user: publicUser({ ...req.user, name: b.name, phone: b.phone }) });
}));

const traveller = z.object({
  firstName: z.string().trim().min(1).max(40), lastName: z.string().trim().min(1).max(40),
  dob: z.string().regex(/^\d{4}-\d{2}-\d{2}$/), gender: z.enum(['M', 'F']),
  passport: z.object({ number: z.string(), expiry: z.string(), country: z.string() }).optional(),
});
account.get('/travellers', (req, res) => {
  res.json({ travellers: db.prepare('SELECT id, data FROM saved_travellers WHERE user_id = ? ORDER BY id').all(req.user.id).map((r) => ({ id: r.id, ...JSON.parse(r.data) })) });
});
account.post('/travellers', wrap((req, res) => {
  const t = traveller.parse(req.body);
  if (db.prepare('SELECT COUNT(*) n FROM saved_travellers WHERE user_id = ?').get(req.user.id).n >= 20) throw new AppError(400, 'LIMIT', 'You can save up to 20 travellers.');
  const { lastInsertRowid } = db.prepare('INSERT INTO saved_travellers (user_id, data) VALUES (?,?)').run(req.user.id, JSON.stringify(t));
  res.status(201).json({ traveller: { id: Number(lastInsertRowid), ...t } });
}));
account.delete('/travellers/:id', (req, res) => {
  db.prepare('DELETE FROM saved_travellers WHERE id = ? AND user_id = ?').run(Number(req.params.id), req.user.id);
  res.json({ ok: true });
});

account.get('/rewards', (req, res) => {
  const life = lifetimePoints(req.user.id);
  res.json({ points: pointsBalance(req.user.id), lifetime: life, tier: tierOf(life), history: db.prepare('SELECT * FROM points_txns WHERE user_id = ? ORDER BY id DESC LIMIT 20').all(req.user.id) });
});
