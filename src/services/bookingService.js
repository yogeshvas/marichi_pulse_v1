import { randomBytes } from 'node:crypto';
import { db, round2 } from '../db.js';
import { config } from '../config.js';
import { AppError } from '../errors.js';
import { provider } from '../providers/index.js';
import * as cache from './offerCache.js';
import * as payments from './payments.js';
import { walletEntry, getAgent } from './wallet.js';
import { getSettings } from './settings.js';
import { audit } from './audit.js';
import { priceWithRewards, addPoints } from './rewards.js';
import { riskOf } from './risk.js';
import { sendBookingEmail } from './notifier.js';

const newRef = () => `SK${randomBytes(4).toString('hex').toUpperCase().slice(0, 6)}`;
const tierOf = (u) => (u?.role === 'agent' ? 'agent' : 'customer');

/* ---------------- pricing tiers ---------------- */

function pct(kind, tier) {
  const s = getSettings();
  return tier === 'agent' ? (kind === 'flight' ? s.agentMarkupFlightPct : s.agentMarkupHotelPct) : (kind === 'flight' ? s.markupFlightPct : s.markupHotelPct);
}
function markFlight(dto, tier) {
  const f = 1 + pct('flight', tier) / 100;
  return { ...dto, price: { ...dto.price, total: round2(dto.price.total * f), perAdult: round2(dto.price.perAdult * f) } };
}
function markOffer(o, tier) {
  const f = 1 + pct('hotel', tier) / 100;
  return { ...o, price: { ...o.price, total: round2(o.price.total * f), perNight: Math.round(o.price.perNight * f) } };
}
const logSearch = (user, kind, key) => db.prepare('INSERT INTO search_log (user_id, kind, key) VALUES (?,?,?)').run(user?.id ?? null, kind, key);

/* ---------------- search and pricing ---------------- */

export async function searchFlights(q, user) {
  const tier = tierOf(user);
  logSearch(user, 'flight', `${q.origin}-${q.destination}`);
  const results = await provider.flights.searchFlights({ ...q, currency: config.currency });
  return results.map(({ dto, raw }) => {
    const id = `fo_${randomBytes(8).toString('hex')}`;
    const marked = markFlight(dto, tier);
    cache.put(id, { raw, dto: marked, adults: q.adults, shownTotal: marked.price.total, tier });
    return { id, ...marked };
  });
}

export async function priceFlight(id) {
  const entry = cache.get(id);
  const priced = await provider.flights.priceFlight(entry.raw);
  const marked = markFlight(priced.dto, entry.tier);
  const changed = marked.price.total !== entry.shownTotal;
  const previousTotal = entry.shownTotal;
  cache.update(id, { raw: priced.raw, dto: marked, shownTotal: marked.price.total });
  return { id, ...marked, priceChanged: changed, previousTotal: changed ? previousTotal : undefined, capabilities: provider.flights.capabilities };
}

export async function flightSeatmaps(id) {
  const entry = cache.get(id);
  return { seatmaps: await provider.flights.flightSeatmaps(entry.raw), seatPurchase: provider.flights.capabilities.seatPurchase };
}

export async function searchHotels(q, user) {
  const tier = tierOf(user);
  logSearch(user, 'hotel', q.cityCode);
  const hotels = await provider.hotels.searchHotels({ ...q, currency: config.currency });
  for (const h of hotels) {
    const { offers, ...hotel } = h;
    h.offers = offers.map((o) => {
      const m = markOffer(o, tier);
      cache.put(o.id, { hotel, offer: m, query: q, shownTotal: m.price.total, tier });
      return m;
    });
  }
  return hotels;
}

export async function refreshHotelOffer(offerId) {
  const entry = cache.get(offerId);
  const fresh = await provider.hotels.refreshHotelOffer(offerId, { ...entry.query, cached: entry.offer });
  // The mock returns the cached (already marked) offer; real providers return supplier prices.
  const offer = provider.name === 'mock' ? fresh : markOffer(fresh, entry.tier);
  const changed = offer.price.total !== entry.shownTotal;
  const previousTotal = entry.shownTotal;
  cache.update(offerId, { offer, shownTotal: offer.price.total });
  return { hotel: entry.hotel, offer, query: entry.query, priceChanged: changed, previousTotal: changed ? previousTotal : undefined };
}

/* ---------------- money handling ---------------- */

function resolveCustomer(user, agentOpts, fallback) {
  if (user.role !== 'agent') return { customerId: null, name: fallback.name, email: fallback.email };
  if (agentOpts?.customerId) {
    const c = db.prepare('SELECT * FROM customers WHERE id = ? AND agent_id = ?').get(agentOpts.customerId, user.id);
    if (!c) throw new AppError(400, 'CUSTOMER_NOT_FOUND', 'Choose one of your customers.');
    return { customerId: c.id, name: c.name, email: c.email || fallback.email };
  }
  const n = agentOpts?.newCustomer || fallback;
  const email = n.email || fallback.email || null;
  const existing = email ? db.prepare('SELECT * FROM customers WHERE agent_id = ? AND lower(email) = lower(?)').get(user.id, email) : null;
  if (existing) return { customerId: existing.id, name: existing.name, email: existing.email };
  const { lastInsertRowid } = db.prepare('INSERT INTO customers (agent_id, name, email, phone) VALUES (?,?,?,?)').run(user.id, n.name, email, n.phone || null);
  return { customerId: Number(lastInsertRowid), name: n.name, email };
}

/** Takes the money. Returns what is needed to undo it and to settle commission afterwards. */
async function takePayment(user, input, { ref, sellTotal, currency, payable = sellTotal }) {
  const opts = input.agent;
  if (user.role === 'agent') {
    const mode = opts?.paymentMode || 'wallet';
    const fee = round2(opts?.serviceFee || 0);
    if (mode === 'wallet') {
      walletEntry(user.id, 'booking', -sellTotal, { ref, note: 'Booking paid from wallet' });
      return { mode, serviceFee: fee, walletDebit: sellTotal, customerTotal: round2(sellTotal + fee) };
    }
    if (!input.card && !input.momo) throw new AppError(400, 'PAYMENT_REQUIRED', 'Enter how the customer will pay.');
    const pay = await payments.chargeAny({ amount: round2(sellTotal + fee), currency, card: input.card, momo: input.momo });
    return { mode, serviceFee: fee, paymentId: pay.id, last4: pay.last4, method: pay.method, network: pay.network, customerTotal: round2(sellTotal + fee) };
  }
  if (!input.card && !input.momo) throw new AppError(400, 'PAYMENT_REQUIRED', 'Choose how you want to pay.');
  const pay = await payments.chargeAny({ amount: payable, currency, card: input.card, momo: input.momo });
  return { mode: 'card', serviceFee: 0, paymentId: pay.id, last4: pay.last4, method: pay.method, network: pay.network, customerTotal: payable };
}

async function undoPayment(user, pay, ref, amount) {
  if (pay.mode === 'wallet') walletEntry(user.id, 'refund', pay.walletDebit, { ref, note: 'Booking failed, wallet refunded', force: true });
  else await payments.refund(pay.paymentId, amount);
}

function settleAgent(user, pay, ref, supplierBase) {
  if (user.role !== 'agent') return 0;
  const a = getAgent(user.id);
  const commission = round2(supplierBase * a.commission_pct / 100);
  if (commission > 0) walletEntry(user.id, 'commission', commission, { ref, note: `Commission ${a.commission_pct}%`, force: true });
  if (pay.mode === 'card' && pay.serviceFee > 0) walletEntry(user.id, 'service_fee', pay.serviceFee, { ref, note: 'Service fee from card payment', force: true });
  return commission;
}

function save(row) {
  db.prepare(`INSERT INTO bookings (ref, user_id, type, status, provider, provider_order_id, provider_ref, total, currency, summary, details,
      agent_id, customer_id, customer_name, customer_email, channel, supplier_total, markup, service_fee, commission, payment_mode, route, start_date,
      discount, promo_code, points_used, points_earned)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`)
    .run(row.ref, row.userId, row.type, 'confirmed', provider.name, row.providerOrderId, row.providerRef, row.total, row.currency,
      JSON.stringify(row.summary), JSON.stringify(row.details), row.agentId, row.customerId, row.customerName, row.customerEmail,
      row.agentId ? 'agent' : 'direct', row.supplierTotal, row.markup, row.serviceFee, row.commission, row.paymentMode, row.route, row.startDate,
      row.discount || 0, row.promoCode || null, row.pointsUsed || 0, row.pointsEarned || 0);
}

/** Called once a booking is confirmed: uses the promo and moves points. */
function settleRewards(user, ref, rw) {
  if (rw.promoCode) db.prepare('UPDATE promo_codes SET used = used + 1 WHERE code = ?').run(rw.promoCode);
  if (user.role !== 'agent') {
    if (rw.pointsUsed) addPoints(user.id, -rw.pointsUsed, 'redeem', ref, 'Redeemed at checkout');
    if (rw.earn) addPoints(user.id, rw.earn, 'earn', ref, 'Booking reward');
  }
}

/* ---------------- booking ---------------- */

async function validateSeats(entry, seats) {
  if (!seats?.length) return { fee: 0, seats: [] };
  const maps = await provider.flights.flightSeatmaps(entry.raw);
  const taken = new Set();
  let fee = 0;
  for (const s of seats) {
    if (s.travelerIndex >= entry.adults) throw new AppError(400, 'SEAT_INVALID', 'Seat assigned to an unknown traveller.');
    const key = `${s.segmentId}:${s.number}`, per = `${s.segmentId}:t${s.travelerIndex}`;
    if (taken.has(key) || taken.has(per)) throw new AppError(400, 'SEAT_INVALID', 'The same seat or traveller was chosen twice.');
    taken.add(key); taken.add(per);
    const map = maps.find((m) => m.segmentId === s.segmentId);
    const cell = map?.rows.flatMap((r) => Object.values(r.cells)).find((c) => c.number === s.number);
    if (!cell || !cell.available) throw new AppError(409, 'SEAT_TAKEN', `Seat ${s.number} is no longer available. Pick another seat.`);
    fee += cell.price;
  }
  return { fee: provider.flights.capabilities.seatPurchase ? fee : 0, seats };
}

export async function bookFlight(user, input) {
  const entry = cache.get(input.offerId);
  if (input.travelers.length !== entry.adults) throw new AppError(400, 'TRAVELLER_COUNT', `This fare is for ${entry.adults} traveller(s).`);
  if (input.agent && user.role !== 'agent') throw new AppError(403, 'FORBIDDEN', 'Only agents can book for customers.');

  const priced = await provider.flights.priceFlight(entry.raw);
  const sell = markFlight(priced.dto, entry.tier);
  if (sell.price.total !== entry.shownTotal && !input.acceptPrice) {
    cache.update(input.offerId, { raw: priced.raw, dto: sell });
    throw new AppError(409, 'PRICE_CHANGED', 'The fare changed since you searched.', { oldTotal: entry.shownTotal, newTotal: sell.price.total });
  }
  const { fee: seatFee, seats } = await validateSeats(entry, input.seats);
  const fareBase = priced.dto.price.total;
  const fareSell = sell.price.total;
  const sellTotal = round2(fareSell + seatFee);
  const currency = sell.price.currency;
  const ref = newRef();

  const t0 = input.travelers[0];
  const customer = resolveCustomer(user, input.agent, { name: `${t0.firstName} ${t0.lastName}`, email: input.contact.email });
  const rw = priceWithRewards(user, 'flight', sellTotal, { promoCode: input.promoCode, usePoints: input.usePoints });
  const pay = await takePayment(user, input, { ref, sellTotal, currency, payable: rw.payable });
  let order;
  try {
    order = await provider.flights.bookFlight({ raw: priced.raw, travelers: input.travelers, contact: input.contact });
  } catch (e) {
    await undoPayment(user, pay, ref, pay.customerTotal);
    throw e;
  }
  const commission = settleAgent(user, pay, ref, fareBase);

  const first = sell.itineraries[0].segments[0];
  const outLast = sell.itineraries[0].segments.at(-1);
  const back = sell.itineraries[1];
  save({
    ref, userId: user.id, type: 'flight', providerOrderId: order.orderId, providerRef: order.pnr, total: pay.customerTotal, currency,
    agentId: user.role === 'agent' ? user.id : null, customerId: customer.customerId, customerName: customer.name, customerEmail: customer.email,
    supplierTotal: round2(fareBase + seatFee), markup: round2(fareSell - fareBase), serviceFee: pay.serviceFee, commission, paymentMode: pay.mode,
    route: `${first.from}-${outLast.to}`, startDate: first.departAt.slice(0, 10),
    discount: rw.discount, promoCode: rw.promoCode, pointsUsed: rw.pointsUsed, pointsEarned: rw.earn || 0,
    summary: {
      title: `${first.from} → ${outLast.to}${back ? ' and back' : ''}`, subtitle: `${first.carrierName} ${first.number}`,
      startDate: first.departAt, endDate: back ? back.segments.at(-1).arriveAt : outLast.arriveAt, people: input.travelers.length,
    },
    details: { offer: sell, travelers: input.travelers, contact: input.contact, seats, seatFee, seatPurchase: provider.flights.capabilities.seatPurchase, pay, fare: fareSell, sellTotal },
  });
  if (pay.paymentId) payments.attachBooking(pay.paymentId, ref);
  settleRewards(user, ref, rw);
  audit(user, 'booking.created', 'booking', ref, { type: 'flight', total: pay.customerTotal });
  await sendBookingEmail(input.contact.email, `Your flight is booked (${order.pnr})`, [`Booking ${ref}`, `Airline reference ${order.pnr}`, `Total ${currency} ${pay.customerTotal}`]);
  return getBooking(user, ref);
}

export async function bookHotel(user, input) {
  const entry = cache.get(input.offerId);
  if (input.agent && user.role !== 'agent') throw new AppError(403, 'FORBIDDEN', 'Only agents can book for customers.');
  const live = provider.hotels.capabilities.cardPassthrough;
  if (live && !config.agencyCard) throw new AppError(503, 'HOTEL_PAYMENT_NOT_CONFIGURED', 'Hotel booking is not set up yet. Ask the administrator to add the agency payment card.');

  const { offer: sell } = await refreshHotelOffer(input.offerId);
  if (sell.price.total !== entry.shownTotal && !input.acceptPrice) {
    throw new AppError(409, 'PRICE_CHANGED', 'The room price changed since you searched.', { oldTotal: entry.shownTotal, newTotal: sell.price.total });
  }
  const base = entry.offer.price.total / (1 + pct('hotel', entry.tier) / 100);
  const supplierBase = round2(base);
  const sellTotal = sell.price.total;
  const currency = sell.price.currency;
  const ref = newRef();
  const customer = resolveCustomer(user, input.agent, { name: `${input.guest.firstName} ${input.guest.lastName}`, email: input.guest.email, phone: input.guest.phone });
  const rw = priceWithRewards(user, 'hotel', sellTotal, { promoCode: input.promoCode, usePoints: input.usePoints });
  const pay = await takePayment(user, input, { ref, sellTotal, currency, payable: rw.payable });

  let order;
  try {
    order = await provider.hotels.bookHotel({ offerId: input.offerId, guests: [{ ...input.guest }], card: config.agencyCard || input.card });
  } catch (e) {
    await undoPayment(user, pay, ref, pay.customerTotal);
    throw e;
  }
  const commission = settleAgent(user, pay, ref, supplierBase);
  const q = entry.query;
  save({
    ref, userId: user.id, type: 'hotel', providerOrderId: order.orderId, providerRef: order.confirmation, total: pay.customerTotal, currency,
    agentId: user.role === 'agent' ? user.id : null, customerId: customer.customerId, customerName: customer.name, customerEmail: customer.email,
    supplierTotal: supplierBase, markup: round2(sellTotal - supplierBase), serviceFee: pay.serviceFee, commission, paymentMode: pay.mode,
    route: entry.hotel.cityCode || q.cityCode, startDate: q.checkIn,
    discount: rw.discount, promoCode: rw.promoCode, pointsUsed: rw.pointsUsed, pointsEarned: rw.earn || 0,
    summary: { title: entry.hotel.name, subtitle: `${sell.room.type} · ${sell.board}`, startDate: q.checkIn, endDate: q.checkOut, people: q.adults },
    details: { hotel: entry.hotel, offer: sell, query: q, guest: input.guest, pay, sellTotal },
  });
  if (pay.paymentId) payments.attachBooking(pay.paymentId, ref);
  settleRewards(user, ref, rw);
  audit(user, 'booking.created', 'booking', ref, { type: 'hotel', total: pay.customerTotal });
  await sendBookingEmail(input.guest.email, `Your stay is booked (${order.confirmation})`, [`Booking ${ref}`, `${entry.hotel.name}, ${q.checkIn} to ${q.checkOut}`, `Total ${currency} ${pay.customerTotal}`]);
  return getBooking(user, ref);
}

/* ---------------- reading bookings (role aware) ---------------- */

function access(actor) {
  if (actor.role === 'admin') return { sql: '1=1', args: [] };
  if (actor.role === 'agent') return { sql: 'b.agent_id = ?', args: [actor.id] };
  return { sql: '(b.user_id = ? OR lower(b.customer_email) = lower(?))', args: [actor.id, actor.email] };
}

export function toDto(r, actor) {
  const staff = actor.role === 'admin';
  const agent = actor.role === 'agent';
  return {
    ref: r.ref, type: r.type, status: r.status, providerRef: r.provider_ref, total: r.total, currency: r.currency,
    refundAmount: r.refund_amount, createdAt: r.created_at, cancelledAt: r.cancelled_at, demo: r.provider === 'mock',
    discount: r.discount || 0, promoCode: r.promo_code, pointsUsed: r.points_used || 0, pointsEarned: r.points_earned || 0,
    channel: r.channel, customerName: r.customer_name, customerEmail: r.customer_email, route: r.route, paymentMode: r.payment_mode,
    agentId: r.agent_id, agentName: r.agent_name || undefined, agency: r.agency || undefined,
    canCancel: r.status === 'confirmed' && (staff || (agent && r.agent_id === actor.id) || (actor.role === 'customer' && r.user_id === actor.id)),
    ...(staff ? { supplierTotal: r.supplier_total, markup: r.markup } : {}),
    ...(staff || agent ? { serviceFee: r.service_fee, commission: r.commission } : {}),
    summary: JSON.parse(r.summary), details: JSON.parse(r.details),
  };
}

const SELECT = `SELECT b.*, u.name AS agent_name, a.agency FROM bookings b LEFT JOIN users u ON u.id = b.agent_id LEFT JOIN agents a ON a.user_id = b.agent_id`;

export function getBooking(actor, ref) {
  const ac = access(actor);
  const r = db.prepare(`${SELECT} WHERE b.ref = ? AND ${ac.sql}`).get(ref, ...ac.args);
  if (!r) throw new AppError(404, 'NOT_FOUND', 'Booking not found.');
  const dto = toDto(r, actor);
  if (actor.role === 'admin') dto.risk = riskOf(r);
  return dto;
}

export function listBookings(actor) {
  const ac = access(actor);
  return db.prepare(`${SELECT} WHERE ${ac.sql} ORDER BY b.created_at DESC`).all(...ac.args).map((r) => toDto(r, actor));
}

/** Paged and filterable list for the agent and admin portals. */
export function manageBookings(actor, f = {}) {
  const ac = access(actor);
  const where = [ac.sql], args = [...ac.args];
  if (f.type) { where.push('b.type = ?'); args.push(f.type); }
  if (f.status) { where.push('b.status = ?'); args.push(f.status); }
  if (f.channel) { where.push('b.channel = ?'); args.push(f.channel); }
  if (f.agentId && actor.role === 'admin') { where.push('b.agent_id = ?'); args.push(Number(f.agentId)); }
  if (f.from) { where.push('date(b.created_at) >= ?'); args.push(f.from); }
  if (f.to) { where.push('date(b.created_at) <= ?'); args.push(f.to); }
  if (f.upcoming) { where.push("b.status = 'confirmed' AND b.start_date >= date('now') AND b.start_date <= date('now', '+14 day')"); }
  if (f.q) {
    where.push('(b.ref LIKE ? OR b.provider_ref LIKE ? OR b.customer_name LIKE ? OR b.customer_email LIKE ? OR b.route LIKE ? OR b.summary LIKE ?)');
    const like = `%${f.q}%`; args.push(like, like, like, like, like, like);
  }
  const page = Math.max(1, Number(f.page) || 1), size = Math.min(100, Number(f.pageSize) || 15);
  const total = db.prepare(`SELECT COUNT(*) n FROM bookings b WHERE ${where.join(' AND ')}`).get(...args).n;
  const rows = db.prepare(`${SELECT} WHERE ${where.join(' AND ')} ORDER BY ${f.upcoming ? 'b.start_date ASC' : 'b.created_at DESC'} LIMIT ? OFFSET ?`).all(...args, size, (page - 1) * size).map((r) => toDto(r, actor));
  return { rows, total, page, pageSize: size };
}

/* ---------------- cancel ---------------- */

export async function cancelBooking(actor, ref) {
  const ac = access(actor);
  const row = db.prepare(`${SELECT} WHERE b.ref = ? AND ${ac.sql}`).get(ref, ...ac.args);
  if (!row) throw new AppError(404, 'NOT_FOUND', 'Booking not found.');
  const b = toDto(row, { role: 'admin' });
  if (row.status !== 'confirmed') throw new AppError(409, 'NOT_CANCELLABLE', 'This booking is already cancelled.');
  if (actor.role === 'customer' && row.user_id !== actor.id) throw new AppError(403, 'FORBIDDEN', 'Only the person who booked can cancel. Contact support.');
  let refund = 0, status = 'cancelled';
  if (b.type === 'flight') {
    await provider.flights.cancelFlight(row.provider_order_id);
    refund = round2(row.total * (1 - getSettings().flightCancelFeePct / 100));
  } else {
    const res = await provider.hotels.cancelHotel(row.provider_order_id);
    const c = b.details.offer.cancellation;
    refund = c.refundable && (!c.deadline || new Date(c.deadline) > new Date()) ? row.total : 0;
    if (res.requested) status = 'cancellation_requested';
  }

  const pay = b.details.pay;
  if (pay.mode === 'wallet') {
    const back = round2(refund * (b.details.sellTotal / row.total));
    if (back > 0) walletEntry(row.agent_id, 'refund', back, { ref, note: 'Cancellation refund', force: true });
  } else if (pay.paymentId) {
    await payments.refund(pay.paymentId, refund);
  }
  if (row.agent_id) {
    if (row.commission > 0) walletEntry(row.agent_id, 'commission_reversal', -row.commission, { ref, note: 'Commission reversed', force: true });
    if (pay.mode === 'card' && row.service_fee > 0) walletEntry(row.agent_id, 'fee_reversal', -row.service_fee, { ref, note: 'Service fee reversed', force: true });
  }
  if (row.points_used) addPoints(row.user_id, row.points_used, 'refund', ref, 'Points returned');
  if (row.points_earned) addPoints(row.user_id, -row.points_earned, 'reverse', ref, 'Reward reversed');
  db.prepare("UPDATE bookings SET status = ?, refund_amount = ?, cancelled_at = datetime('now') WHERE ref = ?").run(status, refund, ref);
  audit(actor, 'booking.cancelled', 'booking', ref, { refund, status });
  return getBooking(actor, ref);
}

/* ---------------- checkout preview and fare calendar ---------------- */

export function quoteCheckout(user, { kind, offerId, extra = 0, promoCode, usePoints }) {
  const entry = cache.get(offerId);
  const base = round2(entry.shownTotal + (kind === 'flight' ? Math.max(0, Number(extra) || 0) : 0));
  return priceWithRewards(user, kind, base, { promoCode, usePoints });
}

const addDays = (iso, n) => { const d = new Date(`${iso}T00:00:00Z`); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };

export async function flightCalendar(q, user) {
  const tier = tierOf(user);
  const today = new Date().toISOString().slice(0, 10);
  const days = [-3, -2, -1, 0, 1, 2, 3].map((n) => addDays(q.date, n)).filter((d) => d >= today);
  let rows;
  if (provider.flights.flightDates) {
    rows = await provider.flights.flightDates({ origin: q.origin, destination: q.destination, from: days[0], to: days.at(-1) });
    rows = days.map((d) => ({ date: d, price: rows.find((r) => r.date === d)?.price ?? null }));
  } else {
    rows = await Promise.all(days.map(async (d) => {
      const res = await provider.flights.searchFlights({ origin: q.origin, destination: q.destination, date: d, adults: 1, cabin: q.cabin || 'ECONOMY' });
      return { date: d, price: res.length ? Math.min(...res.map((r) => r.dto.price.perAdult)) : null };
    }));
  }
  const f = 1 + pct('flight', tier) / 100;
  return rows.map((r) => ({ date: r.date, price: r.price == null ? null : round2(r.price * f * q.adults) }));
}
