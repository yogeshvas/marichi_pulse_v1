import { db } from '../db.js';

/** A simple rule based risk score for the admin booking view. It flags things to look at, it never blocks a booking. */
export function riskOf(row) {
  const reasons = [];
  let score = 0;
  const add = (pts, why) => { score += pts; reasons.push(why); };
  const avg = db.prepare("SELECT AVG(total) a FROM bookings WHERE status = 'confirmed'").get().a || 0;
  if (avg && row.total > avg * 3) add(25, `Value is ${(row.total / avg).toFixed(1)}× the average booking`);

  const owner = db.prepare('SELECT created_at, role FROM users WHERE id = ?').get(row.user_id);
  if (owner && owner.role === 'customer') {
    const ageHours = (Date.now() - new Date(`${owner.created_at.replace(' ', 'T')}Z`).getTime()) / 36e5;
    if (ageHours < 48) add(20, 'Account is less than 2 days old');
    if (ageHours < 48 && row.points_used > 0) add(10, 'Used points on a brand new account');
  }
  const burst = db.prepare("SELECT COUNT(*) n FROM bookings WHERE user_id = ? AND created_at >= datetime(?, '-1 hour') AND created_at <= ?").get(row.user_id, row.created_at, row.created_at).n;
  if (burst >= 3) add(20, `${burst} bookings from the same account within an hour`);
  if (row.status !== 'confirmed' && row.cancelled_at && row.cancelled_at.slice(0, 13) === row.created_at.slice(0, 13)) add(10, 'Cancelled within the hour it was booked');
  if (row.start_date && row.start_date <= new Date(Date.now() + 2 * 864e5).toISOString().slice(0, 10) && row.type === 'flight') add(10, 'Departs within 2 days');
  if (row.discount > 0 && row.discount > row.total * 0.3) add(15, 'Discount is more than 30% of the price paid');
  score = Math.min(100, score);
  return { score, level: score >= 50 ? 'high' : score >= 25 ? 'medium' : 'low', reasons: reasons.length ? reasons : ['Nothing unusual found'] };
}
