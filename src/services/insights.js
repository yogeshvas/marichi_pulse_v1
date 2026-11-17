import { db, round2 } from '../db.js';
import * as rep from './reports.js';

const inr = (n) => `K${Math.round(n).toLocaleString('en-GB')}`;
const pctChange = (cur, prev) => (prev ? ((cur - prev) / prev) * 100 : null);

function routeMovers(scope) {
  const cur = rep.range(scope);
  const len = Math.round((new Date(cur.to) - new Date(cur.from)) / 864e5) + 1;
  const prevTo = new Date(new Date(`${cur.from}T00:00:00Z`).getTime() - 864e5).toISOString().slice(0, 10);
  const prevFrom = new Date(new Date(`${prevTo}T00:00:00Z`).getTime() - (len - 1) * 864e5).toISOString().slice(0, 10);
  const q = (from, to) => new Map(db.prepare(`SELECT route, type, COUNT(*) n FROM bookings WHERE route IS NOT NULL AND date(created_at) BETWEEN ? AND ? ${scope.agentId ? 'AND agent_id = ?' : ''} GROUP BY route, type`).all(from, to, ...(scope.agentId ? [scope.agentId] : [])).map((r) => [`${r.type}:${r.route}`, r.n]));
  const now = q(cur.from, cur.to), before = q(prevFrom, prevTo);
  return [...now.entries()].map(([k, n]) => ({ key: k, n, prev: before.get(k) || 0 })).filter((r) => r.n >= 4).map((r) => ({ ...r, change: r.prev ? ((r.n - r.prev) / r.prev) * 100 : 100 })).sort((a, b) => b.change - a.change);
}

/** Plain-language findings for the dashboard. Every line comes from a number we can show. */
export function insights(scope, user) {
  const o = rep.overview(scope);
  const k = o.kpis, p = o.previous || {};
  const out = [];
  const add = (level, title, detail, action) => out.push({ level, title, detail, ...(action ? { action } : {}) });

  const sc = pctChange(k.sales, p.sales);
  if (sc !== null && Math.abs(sc) >= 5) add(sc > 0 ? 'good' : 'warn', `Sales ${sc > 0 ? 'up' : 'down'} ${Math.abs(sc).toFixed(0)}%`, `${inr(k.sales)} this period against ${inr(p.sales)} in the period before.`);
  if (k.cancelRate >= 15) add('warn', `Cancellations are high at ${k.cancelRate}%`, `${k.cancelled} of ${k.bookings} bookings were cancelled. Check the cancellations report for a pattern.`, { label: 'Open report', href: '#/reports' });
  else if (p.cancelRate && k.cancelRate < p.cancelRate - 2) add('good', 'Fewer cancellations', `Cancellation rate fell from ${p.cancelRate}% to ${k.cancelRate}%.`);
  if (k.conversion && p.conversion && k.conversion < p.conversion * 0.85) add('warn', 'Fewer searches turn into bookings', `Conversion dropped from ${p.conversion}% to ${k.conversion}%. Fares or availability may have changed.`);

  const mover = routeMovers(scope)[0];
  if (mover && mover.change >= 40) { const [type, route] = mover.key.split(':'); add('info', `${route.replace('-', ' to ')} is trending`, `${mover.n} ${type} bookings, up from ${mover.prev}. ${user.role === 'admin' ? 'Consider a promo or more agent focus here.' : 'Customers are asking for it.'}`); }

  const next7 = (o.forecast || []).slice(0, 7).reduce((a, d) => a + d.sales, 0);
  if (next7) add('info', `Expected sales next 7 days: ${inr(next7)}`, 'A forecast from the last 4 weeks, adjusted for which weekdays are busiest.');

  if (user.role === 'admin') {
    const idle = db.prepare(`SELECT u.name, a.agency FROM agents a JOIN users u ON u.id = a.user_id WHERE a.status = 'active'
      AND NOT EXISTS (SELECT 1 FROM bookings b WHERE b.agent_id = a.user_id AND date(b.created_at) >= date('now','-14 day'))`).all();
    if (idle.length) add('warn', `${idle.length} agent${idle.length > 1 ? 's' : ''} inactive for 14 days`, `${idle.slice(0, 3).map((a) => a.agency).join(', ')}${idle.length > 3 ? ' and more' : ''}. A check-in call may help.`, { label: 'View agents', href: '#/agents' });
    const low = db.prepare("SELECT COUNT(*) n FROM agents WHERE status = 'active' AND wallet_balance < 3000").get().n;
    if (low) add('warn', `${low} agent wallet${low > 1 ? 's are' : ' is'} low`, 'Bookings from the wallet fail when the balance runs out.', { label: 'View agents', href: '#/agents' });
    const old = db.prepare("SELECT COUNT(*) n FROM tickets WHERE status = 'open' AND updated_at < datetime('now','-2 day')").get().n;
    if (old) add('warn', `${old} support request${old > 1 ? 's' : ''} waiting over 2 days`, 'Customers are waiting for a reply.', { label: 'Open support', href: '#/support' });
    const avg = db.prepare("SELECT AVG(total) a FROM bookings WHERE status='confirmed'").get().a || 0;
    const big = db.prepare("SELECT COUNT(*) n FROM bookings WHERE status='confirmed' AND date(created_at) >= date('now','-3 day') AND total > ?").get(avg * 3).n;
    if (big) add('info', `${big} unusually large booking${big > 1 ? 's' : ''} in the last 3 days`, 'More than 3 times the average. Open them to see the risk score.', { label: 'View bookings', href: '#/bookings' });
    const disc = k.discounts && k.sales ? (k.discounts / k.sales) * 100 : 0;
    if (disc > 4) add('warn', `Discounts are ${disc.toFixed(1)}% of sales`, 'Promo codes and points are eating into revenue.', { label: 'Review promos', href: '#/promos' });
  } else {
    const a = db.prepare('SELECT wallet_balance FROM agents WHERE user_id = ?').get(user.id);
    if (a && a.wallet_balance < 5000) add('warn', 'Your wallet is running low', `${inr(a.wallet_balance)} left. Top up so bookings do not fail.`, { label: 'Top up', href: '#/wallet' });
    const due = dueCustomers(user.id);
    if (due.length) add('info', `${due.length} customer${due.length > 1 ? 's are' : ' is'} due for a new trip`, `${due.slice(0, 3).map((c) => c.name).join(', ')}${due.length > 3 ? ' and more' : ''} usually book by now.`, { label: 'View customers', href: '#/customers' });
  }
  if (!out.length) add('info', 'Nothing unusual', 'Numbers are steady compared with the previous period.');
  return out;
}

/** Customers whose usual gap between trips has passed. */
export function dueCustomers(agentId) {
  const rows = db.prepare("SELECT c.id, c.name, GROUP_CONCAT(date(b.created_at)) dates FROM customers c JOIN bookings b ON b.customer_id = c.id AND b.status = 'confirmed' WHERE c.agent_id = ? GROUP BY c.id HAVING COUNT(b.ref) >= 2").all(agentId);
  const today = Date.now();
  return rows.map((r) => {
    const d = r.dates.split(',').sort(); const gaps = [];
    for (let i = 1; i < d.length; i++) gaps.push((new Date(d[i]) - new Date(d[i - 1])) / 864e5);
    const avg = gaps.reduce((a, b) => a + b, 0) / gaps.length;
    const since = (today - new Date(d.at(-1))) / 864e5;
    return { id: r.id, name: r.name, avgGap: Math.round(avg), since: Math.round(since), due: since >= avg };
  }).filter((r) => r.due && r.avgGap > 0);
}

/** What an agent should know about one customer. */
export function customerInsight(customerId) {
  const rows = db.prepare("SELECT type, route, total, date(created_at) d FROM bookings WHERE customer_id = ? AND status = 'confirmed' ORDER BY created_at").all(customerId);
  if (!rows.length) return { text: 'No bookings yet. Send a welcome offer to get the first one.', tags: ['New'] };
  const tally = (key) => { const m = new Map(); for (const r of rows) if (r[key]) m.set(r[key], (m.get(r[key]) || 0) + 1); return [...m.entries()].sort((a, b) => b[1] - a[1])[0]; };
  const top = tally('route');
  const flights = rows.filter((r) => r.type === 'flight').length;
  const since = Math.round((Date.now() - new Date(rows.at(-1).d)) / 864e5);
  const avgSpend = rows.reduce((a, r) => a + r.total, 0) / rows.length;
  let gap = null;
  if (rows.length >= 2) { const g = []; for (let i = 1; i < rows.length; i++) g.push((new Date(rows[i].d) - new Date(rows[i - 1].d)) / 864e5); gap = Math.round(g.reduce((a, b) => a + b, 0) / g.length); }
  const tags = [flights >= rows.length / 2 ? 'Flyer' : 'Stays', avgSpend > 25000 ? 'Premium spender' : avgSpend > 12000 ? 'Mid spender' : 'Value seeker'];
  if (rows.length >= 4) tags.push('Repeat customer');
  let text = `Most often books ${top ? top[0].replace('-', ' to ') : 'varied trips'} (${top?.[1] || 0}×) and spends about ${inr(avgSpend)} a booking. Last trip was ${since} days ago.`;
  if (gap && since >= gap) text += ` They usually book every ${gap} days, so they are due now. A call or WhatsApp quote could win the next trip.`;
  else if (gap) text += ` They usually book every ${gap} days.`;
  return { text, tags, dueNow: gap ? since >= gap : false };
}
void round2;
