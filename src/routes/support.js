import { Router } from 'express';
import { z } from 'zod';
import { db } from '../db.js';
import { AppError } from '../errors.js';
import { requireAuth } from '../middleware/auth.js';
import { wrap } from '../middleware/error.js';

export const support = Router();
support.use(requireAuth);

function visible(u) {
  if (u.role === 'admin') return { sql: '1=1', args: [] };
  if (u.role === 'agent') return { sql: '(t.user_id = ? OR t.booking_ref IN (SELECT ref FROM bookings WHERE agent_id = ?))', args: [u.id, u.id] };
  return { sql: 't.user_id = ?', args: [u.id] };
}
const LIST = `SELECT t.*, u.name requester, (SELECT COUNT(*) FROM ticket_messages m WHERE m.ticket_id = t.id) messages FROM tickets t JOIN users u ON u.id = t.user_id`;

support.get('/', (req, res) => {
  const v = visible(req.user);
  const st = ['open', 'closed'].includes(req.query.status) ? ' AND t.status = ?' : '';
  res.json({ tickets: db.prepare(`${LIST} WHERE ${v.sql}${st} ORDER BY t.updated_at DESC LIMIT 200`).all(...v.args, ...(st ? [req.query.status] : [])) });
});

support.post('/', wrap((req, res) => {
  const b = z.object({ subject: z.string().trim().min(4, 'Add a short subject').max(120), bookingRef: z.string().max(20).optional(), message: z.string().trim().min(5, 'Describe the problem').max(2000) }).parse(req.body);
  if (b.bookingRef) {
    const ok = db.prepare('SELECT 1 FROM bookings WHERE ref = ? AND (user_id = ? OR agent_id = ? OR lower(customer_email) = lower(?))').get(b.bookingRef, req.user.id, req.user.id, req.user.email);
    if (!ok) throw new AppError(400, 'BOOKING_NOT_FOUND', 'That booking is not in your account.');
  }
  const { lastInsertRowid } = db.prepare('INSERT INTO tickets (user_id, booking_ref, subject) VALUES (?,?,?)').run(req.user.id, b.bookingRef || null, b.subject);
  db.prepare('INSERT INTO ticket_messages (ticket_id, user_id, author_role, body) VALUES (?,?,?,?)').run(Number(lastInsertRowid), req.user.id, req.user.role, b.message);
  res.status(201).json({ id: Number(lastInsertRowid) });
}));

function load(req) {
  const v = visible(req.user);
  const t = db.prepare(`${LIST} WHERE t.id = ? AND ${v.sql}`).get(Number(req.params.id), ...v.args);
  if (!t) throw new AppError(404, 'NOT_FOUND', 'Ticket not found.');
  return t;
}
support.get('/:id', wrap((req, res) => {
  const t = load(req);
  const messages = db.prepare('SELECT m.*, u.name author FROM ticket_messages m JOIN users u ON u.id = m.user_id WHERE ticket_id = ? ORDER BY m.id').all(t.id);
  res.json({ ticket: t, messages });
}));
support.post('/:id/messages', wrap((req, res) => {
  const t = load(req);
  const { body } = z.object({ body: z.string().trim().min(1).max(2000) }).parse(req.body);
  db.prepare('INSERT INTO ticket_messages (ticket_id, user_id, author_role, body) VALUES (?,?,?,?)').run(t.id, req.user.id, req.user.role, body);
  db.prepare("UPDATE tickets SET updated_at = datetime('now'), status = 'open' WHERE id = ?").run(t.id);
  res.status(201).json({ ok: true });
}));
support.patch('/:id', wrap((req, res) => {
  const t = load(req);
  const { status } = z.object({ status: z.enum(['open', 'closed']) }).parse(req.body);
  db.prepare("UPDATE tickets SET status = ?, updated_at = datetime('now') WHERE id = ?").run(status, t.id);
  res.json({ ok: true });
}));
