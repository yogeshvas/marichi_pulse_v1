import { db, round2 } from '../db.js';

const iso = (d) => d.toISOString().slice(0, 10);
export function range(q = {}) {
  const to = /^\d{4}-\d{2}-\d{2}$/.test(q.to) ? q.to : iso(new Date());
  const from = /^\d{4}-\d{2}-\d{2}$/.test(q.from) ? q.from : iso(new Date(Date.now() - 29 * 864e5));
  return { from, to };
}
function scopeSql(scope, alias = 'b') {
  const w = [`date(${alias}.created_at) BETWEEN ? AND ?`];
  const a = [scope.from, scope.to];
  if (scope.agentId) { w.push(`${alias}.agent_id = ?`); a.push(scope.agentId); }
  if (scope.type) { w.push(`${alias}.type = ?`); a.push(scope.type); }
  if (scope.channel) { w.push(`${alias}.channel = ?`); a.push(scope.channel); }
  return { where: w.join(' AND '), args: a };
}
const days = (from, to) => { const out = []; for (let d = new Date(from); d <= new Date(to); d.setDate(d.getDate() + 1)) out.push(iso(d)); return out; };

function previousScope(scope) {
  const a = new Date(`${scope.from}T00:00:00Z`), b = new Date(`${scope.to}T00:00:00Z`);
  const len = Math.round((b - a) / 864e5) + 1;
  const to = new Date(a.getTime() - 864e5), from = new Date(to.getTime() - (len - 1) * 864e5);
  return { ...scope, from: iso(from), to: iso(to) };
}

/** Next 14 days of sales: recent daily average shaped by the usual weekday pattern. */
export function forecast(scope, horizon = 14) {
  const to = new Date(`${scope.to}T00:00:00Z`);
  const from = iso(new Date(to.getTime() - 27 * 864e5));
  const { where, args } = scopeSql({ ...scope, from, to: scope.to });
  const rows = db.prepare(`SELECT date(created_at) d, COALESCE(SUM(CASE WHEN status='confirmed' THEN total END),0) s FROM bookings b WHERE ${where} GROUP BY d`).all(...args);
  const byDay = new Map(rows.map((r) => [r.d, r.s]));
  const hist = days(from, scope.to).map((d) => ({ d, s: byDay.get(d) || 0, w: new Date(`${d}T00:00:00Z`).getUTCDay() }));
  const mean = hist.reduce((a, h) => a + h.s, 0) / (hist.length || 1);
  if (!mean) return [];
  const factor = Array.from({ length: 7 }, (_, w) => { const x = hist.filter((h) => h.w === w); return x.length ? (x.reduce((a, h) => a + h.s, 0) / x.length) / mean : 1; });
  const base = hist.slice(-14).reduce((a, h) => a + h.s, 0) / Math.max(1, hist.slice(-14).length);
  return Array.from({ length: horizon }, (_, i) => {
    const d = new Date(to.getTime() + (i + 1) * 864e5);
    return { date: iso(d), sales: round2(base * (factor[d.getUTCDay()] || 1)) };
  });
}

export function overview(scope, withPrevious = true) {
  const { where, args } = scopeSql(scope);
  const k = db.prepare(`SELECT COUNT(*) bookings,
      COALESCE(SUM(CASE WHEN status='confirmed' THEN total END),0) sales,
      COALESCE(SUM(CASE WHEN status='confirmed' THEN supplier_total END),0) cost,
      COALESCE(SUM(CASE WHEN status='confirmed' THEN markup END),0) markup,
      COALESCE(SUM(CASE WHEN status='confirmed' THEN discount END),0) discounts,
      COALESCE(SUM(CASE WHEN status='confirmed' THEN commission END),0) commission,
      COALESCE(SUM(CASE WHEN status='confirmed' THEN service_fee END),0) fees,
      SUM(CASE WHEN status!='confirmed' THEN 1 ELSE 0 END) cancelled,
      COALESCE(SUM(refund_amount),0) refunds,
      COUNT(DISTINCT lower(customer_email)) customers
    FROM bookings b WHERE ${where}`).get(...args);
  const confirmed = k.bookings - k.cancelled;

  const byDay = new Map(db.prepare(`SELECT date(created_at) d, COUNT(*) n, COALESCE(SUM(CASE WHEN status='confirmed' THEN total END),0) sales,
      COALESCE(SUM(CASE WHEN status='confirmed' THEN markup-commission-discount END),0) revenue FROM bookings b WHERE ${where} GROUP BY d`).all(...args).map((r) => [r.d, r]));
  const series = days(scope.from, scope.to).map((d) => ({ date: d, bookings: byDay.get(d)?.n || 0, sales: round2(byDay.get(d)?.sales || 0), revenue: round2(byDay.get(d)?.revenue || 0) }));

  const mix = db.prepare(`SELECT type, COUNT(*) n, COALESCE(SUM(CASE WHEN status='confirmed' THEN total END),0) sales FROM bookings b WHERE ${where} GROUP BY type`).all(...args);
  const channels = db.prepare(`SELECT channel, COUNT(*) n, COALESCE(SUM(CASE WHEN status='confirmed' THEN total END),0) sales FROM bookings b WHERE ${where} GROUP BY channel`).all(...args);
  const topRoutes = db.prepare(`SELECT route, type, COUNT(*) n, COALESCE(SUM(CASE WHEN status='confirmed' THEN total END),0) sales FROM bookings b WHERE ${where} AND route IS NOT NULL GROUP BY route, type ORDER BY n DESC, sales DESC LIMIT 8`).all(...args);
  const weekdays = db.prepare(`SELECT CAST(strftime('%w', created_at) AS INTEGER) d, COUNT(*) n FROM bookings b WHERE ${where} GROUP BY d`).all(...args);

  const sw = ['date(created_at) BETWEEN ? AND ?']; const sa = [scope.from, scope.to];
  if (scope.agentId) { sw.push('user_id = ?'); sa.push(scope.agentId); }
  const searches = db.prepare(`SELECT COUNT(*) n FROM search_log WHERE ${sw.join(' AND ')}`).get(...sa).n;

  const out = {
    range: scope,
    kpis: {
      bookings: k.bookings, confirmed, cancelled: k.cancelled, cancelRate: k.bookings ? round2((k.cancelled / k.bookings) * 100) : 0,
      sales: round2(k.sales), avgValue: confirmed ? round2(k.sales / confirmed) : 0, refunds: round2(k.refunds), customers: k.customers,
      revenue: round2(k.markup - k.commission - k.discounts), discounts: round2(k.discounts), commission: round2(k.commission), serviceFees: round2(k.fees),
      searches, conversion: searches ? round2((k.bookings / searches) * 100) : 0,
    },
    series, mix, channels, topRoutes,
    weekdays: Array.from({ length: 7 }, (_, i) => weekdays.find((w) => w.d === i)?.n || 0),
  };
  if (withPrevious) { out.previous = overview(previousScope(scope), false).kpis; out.forecast = forecast(scope); }
  if (!scope.agentId) {
    out.topAgents = db.prepare(`SELECT b.agent_id id, u.name, a.agency, COUNT(*) n, COALESCE(SUM(CASE WHEN b.status='confirmed' THEN b.total END),0) sales,
        COALESCE(SUM(b.commission),0) commission FROM bookings b JOIN users u ON u.id = b.agent_id JOIN agents a ON a.user_id = b.agent_id
        WHERE ${where} GROUP BY b.agent_id ORDER BY sales DESC LIMIT 5`).all(...args);
  }
  return out;
}

export function salesRows(scope) {
  const { where, args } = scopeSql(scope);
  return db.prepare(`SELECT b.ref, b.created_at, b.type, b.status, b.channel, b.route, b.customer_name, b.customer_email, u.name agent, a.agency,
      b.supplier_total, b.markup, b.service_fee, b.commission, b.discount, b.promo_code, b.total, b.refund_amount, b.payment_mode, b.provider_ref
      FROM bookings b LEFT JOIN users u ON u.id = b.agent_id LEFT JOIN agents a ON a.user_id = b.agent_id WHERE ${where} ORDER BY b.created_at DESC`).all(...args);
}

export function agentPerformance(scope) {
  const { where, args } = scopeSql(scope);
  return db.prepare(`SELECT u.id, u.name, a.agency, a.status, a.commission_pct, a.wallet_balance,
      COUNT(b.ref) bookings, COALESCE(SUM(CASE WHEN b.status='confirmed' THEN b.total END),0) sales,
      COALESCE(SUM(CASE WHEN b.status='confirmed' THEN b.commission END),0) commission,
      COALESCE(SUM(CASE WHEN b.status='confirmed' THEN b.service_fee END),0) fees,
      SUM(CASE WHEN b.status!='confirmed' THEN 1 ELSE 0 END) cancelled
    FROM agents a JOIN users u ON u.id = a.user_id LEFT JOIN bookings b ON b.agent_id = a.user_id AND ${where}
    GROUP BY u.id ORDER BY sales DESC`).all(...args);
}

export function cancellations(scope) {
  const { where, args } = scopeSql(scope);
  return db.prepare(`SELECT b.ref, b.type, b.status, b.customer_name, b.route, b.total, b.refund_amount, b.cancelled_at, b.created_at, u.name agent
      FROM bookings b LEFT JOIN users u ON u.id = b.agent_id WHERE ${where} AND b.status != 'confirmed' ORDER BY b.cancelled_at DESC`).all(...args);
}

export function toCsv(rows) {
  if (!rows.length) return '';
  const cols = Object.keys(rows[0]);
  const cell = (v) => { const s = v == null ? '' : String(v); return /[",\n]/.test(s) ? `"${s.replaceAll('"', '""')}"` : s; };
  return [cols.join(','), ...rows.map((r) => cols.map((c) => cell(r[c])).join(','))].join('\n');
}
