import { Router } from 'express';
import bcrypt from 'bcryptjs';
import { z } from 'zod';
import { db } from '../db.js';
import { AppError } from '../errors.js';
import { wrap } from '../middleware/error.js';
import { requireAuth, signToken, publicUser } from '../middleware/auth.js';
import { register, login } from '../schemas.js';
import { getSettings } from '../services/settings.js';
import { audit } from '../services/audit.js';

export const auth = Router();

async function createUser({ name, email, password, role = 'customer', phone = null }) {
  if (db.prepare('SELECT 1 FROM users WHERE email = ?').get(email)) throw new AppError(409, 'EMAIL_TAKEN', 'An account with this email already exists. Sign in instead.');
  const hash = await bcrypt.hash(password, 10);
  const { lastInsertRowid } = db.prepare('INSERT INTO users (email, name, password_hash, role, phone) VALUES (?,?,?,?,?)').run(email, name, hash, role, phone);
  return db.prepare('SELECT id, email, name, role, phone FROM users WHERE id = ?').get(Number(lastInsertRowid));
}
export { createUser };

auth.post('/register', wrap(async (req, res) => {
  const user = await createUser(register.parse(req.body));
  res.status(201).json({ token: signToken(user), user: publicUser(user) });
}));

const agentReg = register.extend({ agency: z.string().trim().min(2).max(80), phone: z.string().regex(/^\+?\d{8,15}$/, 'Enter a valid phone number') });
auth.post('/register-agent', wrap(async (req, res) => {
  const body = agentReg.parse(req.body);
  const user = await createUser({ ...body, role: 'agent' });
  db.prepare('INSERT INTO agents (user_id, agency, commission_pct, status) VALUES (?,?,?,?)').run(user.id, body.agency, getSettings().defaultCommissionPct, 'pending');
  audit(user, 'agent.registered', 'agent', user.id, { agency: body.agency });
  res.status(201).json({ token: signToken(user), user: { ...publicUser(user), agentStatus: 'pending' } });
}));

auth.post('/login', wrap(async (req, res) => {
  const { email, password } = login.parse(req.body);
  const row = db.prepare('SELECT * FROM users WHERE email = ?').get(email);
  const ok = row && await bcrypt.compare(password, row.password_hash);
  if (!ok) throw new AppError(401, 'BAD_CREDENTIALS', 'Email or password is wrong.');
  if (row.status !== 'active') throw new AppError(403, 'ACCOUNT_SUSPENDED', 'This account is suspended. Contact support.');
  const agent = row.role === 'agent' ? db.prepare('SELECT status FROM agents WHERE user_id = ?').get(row.id) : null;
  res.json({ token: signToken(row), user: { ...publicUser(row), ...(agent ? { agentStatus: agent.status } : {}) } });
}));

auth.get('/me', requireAuth, (req, res) => {
  res.json({ user: { ...publicUser(req.user), ...(req.user.agentStatus ? { agentStatus: req.user.agentStatus } : {}) } });
});
