import jwt from 'jsonwebtoken';
import { config } from '../config.js';
import { db } from '../db.js';
import { AppError } from '../errors.js';

export const signToken = (user) => jwt.sign({ sub: user.id }, config.jwtSecret, { expiresIn: '7d' });

export const publicUser = (u) => ({ id: u.id, email: u.email, name: u.name, role: u.role, phone: u.phone || '' });

function load(req) {
  const h = req.headers.authorization || '';
  if (!h.startsWith('Bearer ')) return null;
  let p;
  try { p = jwt.verify(h.slice(7), config.jwtSecret); } catch { throw new AppError(401, 'UNAUTHENTICATED', 'Your session expired. Please sign in again.'); }
  const u = db.prepare('SELECT id, email, name, role, phone, status FROM users WHERE id = ?').get(p.sub);
  if (!u) throw new AppError(401, 'UNAUTHENTICATED', 'Please sign in again.');
  if (u.status !== 'active') throw new AppError(403, 'ACCOUNT_SUSPENDED', 'This account is suspended. Contact support.');
  if (u.role === 'agent') {
    const a = db.prepare('SELECT status FROM agents WHERE user_id = ?').get(u.id);
    u.agentStatus = a?.status || 'pending';
  }
  return u;
}

export function optionalAuth(req, _res, next) {
  try { req.user = load(req) || undefined; next(); } catch { req.user = undefined; next(); }
}

export function requireAuth(req, _res, next) {
  try {
    const u = load(req);
    if (!u) throw new AppError(401, 'UNAUTHENTICATED', 'Please sign in to continue.');
    req.user = u;
    next();
  } catch (e) { next(e); }
}

export const requireRole = (...roles) => (req, _res, next) => {
  requireAuth(req, _res, (err) => {
    if (err) return next(err);
    if (!roles.includes(req.user.role)) return next(new AppError(403, 'FORBIDDEN', 'You do not have access to this area.'));
    if (req.user.role === 'agent' && req.user.agentStatus !== 'active' && !req.allowPendingAgent) {
      return next(new AppError(403, 'AGENT_NOT_ACTIVE', req.user.agentStatus === 'pending' ? 'Your agent account is waiting for approval.' : 'Your agent account is not active.'));
    }
    next();
  });
};
