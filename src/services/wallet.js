import { db, round2 } from '../db.js';
import { AppError } from '../errors.js';

export const getAgent = (id) => db.prepare('SELECT a.*, u.name, u.email, u.phone FROM agents a JOIN users u ON u.id = a.user_id WHERE a.user_id = ?').get(id);

export function walletEntry(agentId, type, amount, { ref = null, note = null, force = false } = {}) {
  const a = db.prepare('SELECT wallet_balance, credit_limit FROM agents WHERE user_id = ?').get(agentId);
  if (!a) throw new AppError(404, 'AGENT_NOT_FOUND', 'Agent account not found.');
  const next = round2(a.wallet_balance + amount);
  if (!force && amount < 0 && next < -a.credit_limit) {
    throw new AppError(402, 'WALLET_LOW', `Wallet balance is too low. Top up at least ${Math.ceil(-a.credit_limit - next)} to continue.`);
  }
  db.prepare('UPDATE agents SET wallet_balance = ? WHERE user_id = ?').run(next, agentId);
  db.prepare('INSERT INTO wallet_txns (agent_id, type, amount, balance_after, booking_ref, note) VALUES (?,?,?,?,?,?)').run(agentId, type, round2(amount), next, ref, note);
  return next;
}
