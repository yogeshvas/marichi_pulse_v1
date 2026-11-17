import { db, round2 } from '../db.js';
import { AppError } from '../errors.js';

export const POINT_VALUE = 1;          // 1 point = K1 off
export const EARN_PER = 100;           // 1 point per K100 paid
export const MAX_POINTS_SHARE = 0.1;   // points can cover up to 10% of the price
export const MAX_DISCOUNT_SHARE = 0.5; // no booking is discounted by more than half

export const pointsBalance = (userId) => db.prepare('SELECT COALESCE(SUM(points),0) n FROM points_txns WHERE user_id = ?').get(userId).n;
export const lifetimePoints = (userId) => db.prepare("SELECT COALESCE(SUM(points),0) n FROM points_txns WHERE user_id = ? AND points > 0 AND type = 'earn'").get(userId).n;
export const tierOf = (lifetime) => (lifetime >= 2000 ? { name: 'Gold', next: null, at: 2000 } : lifetime >= 500 ? { name: 'Silver', next: 'Gold', at: 2000 } : { name: 'Bronze', next: 'Silver', at: 500 });

export function addPoints(userId, points, type, ref, note) {
  if (!points) return;
  db.prepare('INSERT INTO points_txns (user_id, points, type, booking_ref, note) VALUES (?,?,?,?,?)').run(userId, points, type, ref ?? null, note ?? null);
}

export function findPromo(code) {
  return db.prepare('SELECT * FROM promo_codes WHERE code = ?').get(String(code || '').trim().toUpperCase());
}

/** Checks a promo code against a booking. Throws a friendly error when it does not apply. */
export function checkPromo(code, kind, total) {
  const p = findPromo(code);
  if (!p || !p.active) throw new AppError(400, 'PROMO_INVALID', 'This code is not valid.');
  if (p.expires_at && p.expires_at < new Date().toISOString().slice(0, 10)) throw new AppError(400, 'PROMO_EXPIRED', 'This code has expired.');
  if (p.max_uses != null && p.used >= p.max_uses) throw new AppError(400, 'PROMO_USED_UP', 'This code has been fully used.');
  if (p.applies_to !== 'all' && p.applies_to !== kind) throw new AppError(400, 'PROMO_WRONG_PRODUCT', `This code is only for ${p.applies_to}s.`);
  if (total < p.min_total) throw new AppError(400, 'PROMO_MIN', `Spend at least K${Math.round(p.min_total).toLocaleString('en-GB')} to use this code.`);
  let off = p.type === 'percent' ? total * p.value / 100 : p.value;
  if (p.max_discount != null) off = Math.min(off, p.max_discount);
  return { promo: p, amount: round2(Math.min(off, total * MAX_DISCOUNT_SHARE)) };
}

/** Works out the discount for a customer booking. Agents never get promo codes or points. */
export function priceWithRewards(user, kind, total, { promoCode, usePoints } = {}) {
  const out = { total: round2(total), promoDiscount: 0, promoCode: null, pointsUsed: 0, pointsDiscount: 0, discount: 0, payable: round2(total), balance: 0 };
  if (user?.role === 'agent') return out;
  out.balance = user ? pointsBalance(user.id) : 0;
  if (promoCode) {
    const { promo, amount } = checkPromo(promoCode, kind, total);
    out.promoDiscount = amount; out.promoCode = promo.code;
  }
  if (usePoints && user) {
    const room = Math.max(0, total - out.promoDiscount);
    out.pointsUsed = Math.max(0, Math.min(out.balance, Math.floor((room * MAX_POINTS_SHARE) / POINT_VALUE)));
    out.pointsDiscount = round2(out.pointsUsed * POINT_VALUE);
  }
  out.discount = round2(out.promoDiscount + out.pointsDiscount);
  out.payable = round2(total - out.discount);
  out.earn = Math.floor(out.payable / EARN_PER);
  return out;
}

export function publicOffers() {
  const today = new Date().toISOString().slice(0, 10);
  return db.prepare(`SELECT code, description, type, value, min_total, max_discount, applies_to, expires_at FROM promo_codes
    WHERE active = 1 AND (expires_at IS NULL OR expires_at >= ?) AND (max_uses IS NULL OR used < max_uses) ORDER BY created_at DESC LIMIT 6`).all(today);
}
