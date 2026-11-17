import { Router } from 'express';
import { z } from 'zod';
import { db, round2 } from '../db.js';
import { AppError } from '../errors.js';
import { requireRole } from '../middleware/auth.js';
import { wrap } from '../middleware/error.js';
import { getSettings, saveSettings } from '../services/settings.js';
import { walletEntry } from '../services/wallet.js';
import { audit } from '../services/audit.js';
import { createUser } from './auth.js';
import { provider } from '../providers/index.js';

export const admin = Router();
admin.use(requireRole('admin'));

/* ---- agents ---- */
const AGENT_SELECT = `SELECT u.id, u.name, u.email, u.phone, u.status user_status, a.agency, a.status, a.commission_pct, a.wallet_balance, a.credit_limit, a.created_at,
  (SELECT COUNT(*) FROM bookings b WHERE b.agent_id = u.id) bookings,
  (SELECT COALESCE(SUM(total),0) FROM bookings b WHERE b.agent_id = u.id AND b.status='confirmed') sales,
  (SELECT COUNT(*) FROM customers c WHERE c.agent_id = u.id) customers
  FROM agents a JOIN users u ON u.id = a.user_id`;

admin.get('/agents', (req, res) => {
  const where = req.query.status ? 'WHERE a.status = ?' : '';
  res.json({ agents: db.prepare(`${AGENT_SELECT} ${where} ORDER BY a.created_at DESC`).all(...(req.query.status ? [req.query.status] : [])) });
});
admin.post('/agents', wrap(async (req, res) => {
  const b = z.object({
    name: z.string().trim().min(2).max(60), email: z.string().email().toLowerCase(), password: z.string().min(8).max(100),
    agency: z.string().trim().min(2).max(80), phone: z.string().regex(/^\+?\d{8,15}$/, 'Enter a valid phone number'),
    commissionPct: z.number().min(0).max(20).default(getSettings().defaultCommissionPct), creditLimit: z.number().min(0).max(5000000).default(0),
  }).parse(req.body);
  const user = await createUser({ ...b, role: 'agent' });
  db.prepare('INSERT INTO agents (user_id, agency, commission_pct, credit_limit, status) VALUES (?,?,?,?,?)').run(user.id, b.agency, b.commissionPct, b.creditLimit, 'active');
  audit(req.user, 'agent.created', 'agent', user.id, { agency: b.agency });
  res.status(201).json({ agent: db.prepare(`${AGENT_SELECT} WHERE u.id = ?`).get(user.id) });
}));
admin.patch('/agents/:id', wrap((req, res) => {
  const id = Number(req.params.id);
  const b = z.object({ status: z.enum(['pending', 'active', 'suspended']).optional(), commissionPct: z.number().min(0).max(20).optional(), creditLimit: z.number().min(0).max(5000000).optional(), agency: z.string().trim().min(2).max(80).optional() }).parse(req.body);
  const cur = db.prepare('SELECT * FROM agents WHERE user_id = ?').get(id);
  if (!cur) throw new AppError(404, 'NOT_FOUND', 'Agent not found.');
  db.prepare('UPDATE agents SET status = ?, commission_pct = ?, credit_limit = ?, agency = ? WHERE user_id = ?')
    .run(b.status ?? cur.status, b.commissionPct ?? cur.commission_pct, b.creditLimit ?? cur.credit_limit, b.agency ?? cur.agency, id);
  audit(req.user, 'agent.updated', 'agent', id, b);
  res.json({ agent: db.prepare(`${AGENT_SELECT} WHERE u.id = ?`).get(id) });
}));
admin.post('/agents/:id/wallet', wrap((req, res) => {
  const id = Number(req.params.id);
  const b = z.object({ amount: z.number().refine((n) => n !== 0, 'Amount cannot be zero').refine((n) => Math.abs(n) <= 5000000), note: z.string().trim().min(3, 'Add a short reason').max(120) }).parse(req.body);
  const balance = walletEntry(id, b.amount > 0 ? 'adjustment_credit' : 'adjustment_debit', round2(b.amount), { note: b.note, force: true });
  audit(req.user, 'wallet.adjusted', 'agent', id, b);
  res.json({ balance });
}));

/* ---- users ---- */
admin.get('/users', (req, res) => {
  const q = `%${String(req.query.q || '').trim()}%`;
  const roleSql = ['customer', 'agent', 'admin'].includes(req.query.role) ? 'AND u.role = ?' : '';
  const args = [q, q, ...(roleSql ? [req.query.role] : [])];
  const rows = db.prepare(`SELECT u.id, u.name, u.email, u.phone, u.role, u.status, u.created_at,
      (SELECT COUNT(*) FROM bookings b WHERE b.user_id = u.id) bookings,
      (SELECT COALESCE(SUM(total),0) FROM bookings b WHERE b.user_id = u.id AND b.status='confirmed') spent
      FROM users u WHERE (u.name LIKE ? OR u.email LIKE ?) ${roleSql} ORDER BY u.created_at DESC LIMIT 200`).all(...args);
  res.json({ users: rows });
});
admin.patch('/users/:id', wrap((req, res) => {
  const id = Number(req.params.id);
  const { status } = z.object({ status: z.enum(['active', 'suspended']) }).parse(req.body);
  if (id === req.user.id) throw new AppError(400, 'SELF', 'You cannot suspend your own account.');
  const r = db.prepare('UPDATE users SET status = ? WHERE id = ?').run(status, id);
  if (!r.changes) throw new AppError(404, 'NOT_FOUND', 'User not found.');
  audit(req.user, `user.${status}`, 'user', id);
  res.json({ ok: true });
}));

/* ---- settings, audit, system ---- */
const pct = z.number().min(0).max(50);
admin.get('/settings', (_req, res) => res.json({ settings: getSettings() }));
admin.put('/settings', wrap((req, res) => {
  const b = z.object({
    markupFlightPct: pct, markupHotelPct: pct, agentMarkupFlightPct: pct, agentMarkupHotelPct: pct,
    defaultCommissionPct: z.number().min(0).max(20), flightCancelFeePct: z.number().min(0).max(100), supportEmail: z.string().email(),
  }).parse(req.body);
  const saved = saveSettings(b);
  audit(req.user, 'settings.updated', 'settings', null, b);
  res.json({ settings: saved });
}));
admin.get('/audit', (req, res) => {
  const page = Math.max(1, Number(req.query.page) || 1);
  const q = `%${String(req.query.q || '').trim()}%`;
  const total = db.prepare('SELECT COUNT(*) n FROM audit WHERE action LIKE ? OR user_name LIKE ? OR entity_id LIKE ?').get(q, q, q).n;
  const rows = db.prepare('SELECT * FROM audit WHERE action LIKE ? OR user_name LIKE ? OR entity_id LIKE ? ORDER BY id DESC LIMIT 25 OFFSET ?').all(q, q, q, (page - 1) * 25)
    .map((r) => ({ ...r, meta: r.meta ? JSON.parse(r.meta) : null }));
  res.json({ rows, total, page, pageSize: 25 });
});
admin.get('/system', (_req, res) => res.json({
  provider: provider.name, mode: provider.name === 'amadeus' ? 'live' : 'demo',
  agencyCardConfigured: Boolean(process.env.AGENCY_CARD_NUMBER), node: process.version,
  counts: {
    users: db.prepare('SELECT COUNT(*) n FROM users').get().n, bookings: db.prepare('SELECT COUNT(*) n FROM bookings').get().n,
    agents: db.prepare('SELECT COUNT(*) n FROM agents').get().n, pendingAgents: db.prepare("SELECT COUNT(*) n FROM agents WHERE status='pending'").get().n,
    openTickets: db.prepare("SELECT COUNT(*) n FROM tickets WHERE status='open'").get().n,
  },
}));

/* ---- promo codes ---- */
const promoSchema = z.object({
  code: z.string().trim().toUpperCase().regex(/^[A-Z0-9]{4,20}$/, 'Use 4 to 20 letters or numbers'),
  description: z.string().trim().min(5).max(120),
  type: z.enum(['percent', 'flat']), value: z.number().positive().max(100000),
  minTotal: z.number().min(0).default(0), maxDiscount: z.number().positive().nullable().optional(),
  appliesTo: z.enum(['all', 'flight', 'hotel']).default('all'), maxUses: z.number().int().positive().nullable().optional(),
  expiresAt: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional().or(z.literal('')),
}).refine((v) => v.type !== 'percent' || v.value <= 80, { message: 'Percent cannot be above 80', path: ['value'] });

admin.get('/promos', (_req, res) => res.json({ promos: db.prepare('SELECT * FROM promo_codes ORDER BY created_at DESC').all() }));
admin.post('/promos', wrap((req, res) => {
  const b = promoSchema.parse(req.body);
  if (db.prepare('SELECT 1 FROM promo_codes WHERE code = ?').get(b.code)) throw new AppError(409, 'PROMO_EXISTS', 'That code already exists.');
  db.prepare('INSERT INTO promo_codes (code, description, type, value, min_total, max_discount, applies_to, max_uses, expires_at) VALUES (?,?,?,?,?,?,?,?,?)')
    .run(b.code, b.description, b.type, b.value, b.minTotal, b.maxDiscount ?? null, b.appliesTo, b.maxUses ?? null, b.expiresAt || null);
  audit(req.user, 'promo.created', 'promo', b.code, { type: b.type, value: b.value });
  res.status(201).json({ ok: true });
}));
admin.patch('/promos/:code', wrap((req, res) => {
  const { active } = z.object({ active: z.boolean() }).parse(req.body);
  const r = db.prepare('UPDATE promo_codes SET active = ? WHERE code = ?').run(active ? 1 : 0, req.params.code);
  if (!r.changes) throw new AppError(404, 'NOT_FOUND', 'Code not found.');
  audit(req.user, active ? 'promo.enabled' : 'promo.disabled', 'promo', req.params.code);
  res.json({ ok: true });
}));
