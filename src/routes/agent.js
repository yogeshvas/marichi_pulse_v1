import { Router } from 'express';
import { z } from 'zod';
import { db, round2 } from '../db.js';
import { AppError } from '../errors.js';
import { requireRole } from '../middleware/auth.js';
import { wrap } from '../middleware/error.js';
import { getAgent, walletEntry } from '../services/wallet.js';
import * as payments from '../services/payments.js';
import { audit } from '../services/audit.js';
import { card, momo } from '../schemas.js';
import { customerInsight } from '../services/insights.js';

export const agent = Router();
agent.use(requireRole('agent'));

const agentDto = (a) => ({ agency: a.agency, name: a.name, email: a.email, phone: a.phone || '', commissionPct: a.commission_pct, walletBalance: a.wallet_balance, creditLimit: a.credit_limit, status: a.status, since: a.created_at });

agent.get('/me', (req, res) => res.json({ agent: agentDto(getAgent(req.user.id)) }));
agent.patch('/me', wrap((req, res) => {
  const b = z.object({ name: z.string().trim().min(2).max(60), agency: z.string().trim().min(2).max(80), phone: z.string().regex(/^\+?\d{8,15}$/).optional().or(z.literal('')) }).parse(req.body);
  db.prepare('UPDATE users SET name = ?, phone = ? WHERE id = ?').run(b.name, b.phone || null, req.user.id);
  db.prepare('UPDATE agents SET agency = ? WHERE user_id = ?').run(b.agency, req.user.id);
  res.json({ agent: agentDto(getAgent(req.user.id)) });
}));

/* ---- customers (agent CRM) ---- */
const customerSchema = z.object({ name: z.string().trim().min(2).max(80), email: z.string().email().optional().or(z.literal('')), phone: z.string().max(20).optional(), notes: z.string().max(500).optional() });
const withStats = `SELECT c.*, (SELECT COUNT(*) FROM bookings b WHERE b.customer_id = c.id) bookings,
  (SELECT COALESCE(SUM(total),0) FROM bookings b WHERE b.customer_id = c.id AND b.status='confirmed') spent,
  (SELECT MAX(created_at) FROM bookings b WHERE b.customer_id = c.id) last_booking FROM customers c`;

agent.get('/customers', (req, res) => {
  const q = String(req.query.q || '').trim();
  const like = `%${q}%`;
  const rows = q
    ? db.prepare(`${withStats} WHERE c.agent_id = ? AND (c.name LIKE ? OR c.email LIKE ? OR c.phone LIKE ?) ORDER BY c.name`).all(req.user.id, like, like, like)
    : db.prepare(`${withStats} WHERE c.agent_id = ? ORDER BY c.name`).all(req.user.id);
  res.json({ customers: rows });
});
agent.post('/customers', wrap((req, res) => {
  const b = customerSchema.parse(req.body);
  const { lastInsertRowid } = db.prepare('INSERT INTO customers (agent_id, name, email, phone, notes) VALUES (?,?,?,?,?)').run(req.user.id, b.name, b.email || null, b.phone || null, b.notes || null);
  res.status(201).json({ customer: db.prepare(`${withStats} WHERE c.id = ?`).get(Number(lastInsertRowid)) });
}));
agent.get('/customers/:id', wrap((req, res) => {
  const c = db.prepare(`${withStats} WHERE c.id = ? AND c.agent_id = ?`).get(Number(req.params.id), req.user.id);
  if (!c) throw new AppError(404, 'NOT_FOUND', 'Customer not found.');
  const bookings = db.prepare('SELECT ref, type, status, total, currency, created_at, summary FROM bookings WHERE customer_id = ? ORDER BY created_at DESC').all(c.id)
    .map((r) => ({ ...r, summary: JSON.parse(r.summary) }));
  res.json({ customer: c, bookings, insight: customerInsight(c.id) });
}));
agent.put('/customers/:id', wrap((req, res) => {
  const b = customerSchema.parse(req.body);
  const r = db.prepare('UPDATE customers SET name = ?, email = ?, phone = ?, notes = ? WHERE id = ? AND agent_id = ?').run(b.name, b.email || null, b.phone || null, b.notes || null, Number(req.params.id), req.user.id);
  if (!r.changes) throw new AppError(404, 'NOT_FOUND', 'Customer not found.');
  res.json({ customer: db.prepare(`${withStats} WHERE c.id = ?`).get(Number(req.params.id)) });
}));
agent.delete('/customers/:id', wrap((req, res) => {
  const id = Number(req.params.id);
  if (db.prepare('SELECT 1 FROM bookings WHERE customer_id = ?').get(id)) throw new AppError(409, 'HAS_BOOKINGS', 'This customer has bookings, so they cannot be deleted.');
  db.prepare('DELETE FROM customers WHERE id = ? AND agent_id = ?').run(id, req.user.id);
  res.json({ ok: true });
}));

/* ---- wallet ---- */
agent.get('/wallet', (req, res) => {
  const a = getAgent(req.user.id);
  const page = Math.max(1, Number(req.query.page) || 1);
  const total = db.prepare('SELECT COUNT(*) n FROM wallet_txns WHERE agent_id = ?').get(req.user.id).n;
  const txns = db.prepare('SELECT * FROM wallet_txns WHERE agent_id = ? ORDER BY id DESC LIMIT 20 OFFSET ?').all(req.user.id, (page - 1) * 20);
  res.json({ balance: a.wallet_balance, creditLimit: a.credit_limit, txns, total, page, pageSize: 20 });
});
agent.post('/wallet/topup', wrap(async (req, res) => {
  const b = z.object({ amount: z.number().min(100).max(200000), card: card.optional(), momo: momo.optional() }).refine((v) => v.card || v.momo, { message: 'Choose how to pay', path: ['amount'] }).parse(req.body);
  const pay = await payments.chargeAny({ amount: b.amount, currency: 'ZMW', card: b.card, momo: b.momo });
  const balance = walletEntry(req.user.id, 'topup', round2(b.amount), { note: pay.method === 'momo' ? `${pay.network.toUpperCase()} mobile money ending ${pay.last4}` : `Card ending ${pay.last4}` });
  audit(req.user, 'wallet.topup', 'agent', req.user.id, { amount: b.amount });
  res.status(201).json({ balance });
}));
