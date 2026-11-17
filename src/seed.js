import bcrypt from 'bcryptjs';
import { db, round2 } from './db.js';
import { config } from './config.js';
import { getSettings } from './services/settings.js';
import { rng, pick, randInt, code } from './providers/mock/util.js';
import * as mockFlights from './providers/mock/flights.js';
import * as mockHotels from './providers/mock/hotels.js';

const hash = (p) => bcrypt.hashSync(p, 10);
const ymd = (d) => d.toISOString().slice(0, 10);
const ts = (d, r) => `${ymd(d)} ${String(randInt(r, 7, 22)).padStart(2, '0')}:${String(randInt(r, 0, 59)).padStart(2, '0')}:${String(randInt(r, 0, 59)).padStart(2, '0')}`;

/** Creates the first administrator. In development a known password is used and printed. */
export function ensureAdmin() {
  if (db.prepare("SELECT 1 FROM users WHERE role = 'admin'").get()) return;
  const email = (process.env.ADMIN_EMAIL || 'admin@skyline.test').toLowerCase();
  const password = process.env.ADMIN_PASSWORD || (config.env === 'production' ? '' : 'Admin@12345');
  if (!password) { console.warn('No admin exists. Set ADMIN_EMAIL and ADMIN_PASSWORD, then restart.'); return; }
  db.prepare("INSERT INTO users (email, name, password_hash, role) VALUES (?,?,?, 'admin')").run(email, 'Platform Admin', hash(password));
  console.log(`Admin account created: ${email}${process.env.ADMIN_PASSWORD ? '' : ' / Admin@12345 (change it)'}`);
}

const FIRST = ['Chanda', 'Mutale', 'Mwansa', 'Bwalya', 'Thandiwe', 'Natasha', 'Kondwani', 'Namukolo', 'Chileshe', 'Mulenga', 'Temwani', 'Given', 'Mapalo', 'Luyando', 'Nkandu', 'Kabwe'];
const LAST = ['Mulenga', 'Banda', 'Phiri', 'Tembo', 'Zulu', 'Mwale', 'Lungu', 'Chileshe', 'Sakala', 'Daka', 'Musonda', 'Ngoma'];
const ROUTES = [['LUN', 'LVI'], ['LVI', 'LUN'], ['LUN', 'NLA'], ['NLA', 'LUN'], ['LUN', 'MFU'], ['LUN', 'JNB'], ['JNB', 'LUN'], ['LUN', 'NBO'], ['LUN', 'ADD'], ['LUN', 'DXB'], ['LUN', 'HRE'], ['LUN', 'CPT'], ['NLA', 'JNB'], ['LUN', 'LHR']];
const CITIES = ['LVI', 'LUN', 'MFU', 'NLA', 'LVI', 'LUN', 'VFA', 'CPT'];
const AGENCIES = [['Kafue Travel and Tours', 'Mwila Chanda'], ['Mosi-oa-Tunya Holidays', 'Brian Mumba'], ['Copperbelt Safaris', 'Natasha Zimba'], ['Zambezi Explorers', 'Peter Kunda']];

export async function seedDemo({ force = false } = {}) {
  if (!force && db.prepare('SELECT 1 FROM bookings LIMIT 1').get()) return false;
  const s = getSettings();
  const r = rng('skyline-demo-seed');
  const now = new Date();

  const insUser = db.prepare('INSERT OR IGNORE INTO users (email, name, password_hash, role, phone, created_at) VALUES (?,?,?,?,?,?)');
  const userId = (email) => db.prepare('SELECT id FROM users WHERE email = ?').get(email).id;

  // Agents
  const agents = AGENCIES.map(([agency, person], i) => {
    const email = i === 0 ? 'agent@skyline.test' : `${person.split(' ')[0].toLowerCase()}@agency.test`;
    insUser.run(email, person, hash(i === 0 ? 'Agent@12345' : 'Agent@12345'), 'agent', `+260971${100000 + i}`, ymd(new Date(now - 90 * 864e5)) + ' 09:00:00');
    const id = userId(email);
    db.prepare('INSERT OR IGNORE INTO agents (user_id, agency, commission_pct, credit_limit, status) VALUES (?,?,?,?,?)').run(id, agency, [1.5, 1.2, 2, 1][i], i === 0 ? 15000 : 8000, 'active');
    return { id, balance: 0, commissionPct: [1.5, 1.2, 2, 1][i], weight: [4, 3, 2, 1][i] };
  });
  insUser.run('newagent@agency.test', 'Grace Mwamba', hash('Agent@12345'), 'agent', '+260971234567', ymd(new Date(now - 2 * 864e5)) + ' 11:00:00');
  db.prepare('INSERT OR IGNORE INTO agents (user_id, agency, commission_pct, status) VALUES (?,?,?,?)').run(userId('newagent@agency.test'), 'Luangwa Getaways', 1.5, 'pending');

  // Direct customers and agent CRM customers
  insUser.run('customer@skyline.test', 'Chanda Mulenga', hash('Customer@12345'), 'customer', '+260971234567', ymd(new Date(now - 80 * 864e5)) + ' 10:00:00');
  const direct = Array.from({ length: 14 }, (_, i) => {
    const name = `${pick(r, FIRST)} ${pick(r, LAST)}`;
    const email = i === 0 ? 'customer@skyline.test' : `${name.toLowerCase().replace(' ', '.')}${i}@mail.test`;
    if (i > 0) insUser.run(email, name, hash('Customer@12345'), 'customer', null, ymd(new Date(now - randInt(r, 5, 85) * 864e5)) + ' 12:00:00');
    return { id: userId(email), name: i === 0 ? 'Chanda Mulenga' : name, email };
  });
  const crm = [];
  for (const a of agents) {
    for (let i = 0; i < randInt(r, 7, 11); i++) {
      const name = `${pick(r, FIRST)} ${pick(r, LAST)}`;
      const email = `${name.toLowerCase().replace(' ', '.')}.${a.id}${i}@mail.test`;
      const { lastInsertRowid } = db.prepare('INSERT INTO customers (agent_id, name, email, phone, created_at) VALUES (?,?,?,?,?)').run(a.id, name, email, `+26097${randInt(r, 1000000, 9999999)}`, ymd(new Date(now - randInt(r, 10, 80) * 864e5)) + ' 10:00:00');
      crm.push({ id: Number(lastInsertRowid), agent: a, name, email });
    }
  }

  const insBooking = db.prepare(`INSERT INTO bookings (ref, user_id, type, status, provider, provider_order_id, provider_ref, total, currency, summary, details, refund_amount, created_at, cancelled_at,
    agent_id, customer_id, customer_name, customer_email, channel, supplier_total, markup, service_fee, commission, payment_mode, route, start_date)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`);
  const insSearch = db.prepare('INSERT INTO search_log (user_id, kind, key, created_at) VALUES (?,?,?,?)');
  const insPts = db.prepare('INSERT INTO points_txns (user_id, points, type, booking_ref, note, created_at) VALUES (?,?,?,?,?,?)');
  const insTxn = db.prepare('INSERT INTO wallet_txns (agent_id, type, amount, balance_after, booking_ref, note, created_at) VALUES (?,?,?,?,?,?,?)');
  const txn = (a, type, amount, ref, note, when) => { a.balance = round2(a.balance + amount); insTxn.run(a.id, type, round2(amount), a.balance, ref, note, when); };

  db.exec('BEGIN');
  for (const a of agents) txn(a, 'topup', 60000, null, 'Opening deposit', ymd(new Date(now - 62 * 864e5)) + ' 09:30:00');
  const pool = agents.flatMap((a) => Array(a.weight).fill(a));

  for (let back = 60; back >= 0; back--) {
    const day = new Date(now - back * 864e5);
    const n = randInt(r, 2, 5) + Math.floor((60 - back) / 14) + (day.getDay() === 1 || day.getDay() === 0 ? 2 : 0);
    for (let i = 0; i < n; i++) {
      const created = ts(day, r);
      const byAgent = r() < 0.5;
      const agent = byAgent ? pick(r, pool) : null;
      const who = byAgent ? pick(r, crm.filter((c) => c.agent === agent)) : pick(r, direct);
      const type = r() < 0.66 ? 'flight' : 'hotel';
      const ref = `SK${code(r, 6)}`;
      const start = new Date(day.getTime() + randInt(r, 3, 45) * 864e5);
      const paymentMode = agent ? (r() < 0.8 ? 'wallet' : 'card') : 'card';
      const serviceFee = agent ? pick(r, [0, 50, 100, 150, 200, 300]) : 0;
      let row, sellTotal, base, summary, details, route;
      const tierPct = (agent ? (type === 'flight' ? s.agentMarkupFlightPct : s.agentMarkupHotelPct) : (type === 'flight' ? s.markupFlightPct : s.markupHotelPct)) / 100;

      if (type === 'flight') {
        const [o, d] = pick(r, ROUTES);
        const adults = r() < 0.7 ? 1 : randInt(r, 2, 3);
        const found = (await mockFlights.searchFlights({ origin: o, destination: d, date: ymd(start), returnDate: r() < 0.3 ? ymd(new Date(start.getTime() + 4 * 864e5)) : undefined, adults, cabin: 'ECONOMY' }));
        const offer = found[randInt(r, 0, Math.min(5, found.length - 1))].dto;
        base = offer.price.total;
        sellTotal = round2(base * (1 + tierPct));
        const sell = { ...offer, price: { ...offer.price, total: sellTotal, perAdult: round2(sellTotal / adults) } };
        const a0 = sell.itineraries[0].segments[0], z0 = sell.itineraries[0].segments.at(-1), back2 = sell.itineraries[1];
        route = `${o}-${d}`;
        summary = { title: `${a0.from} → ${z0.to}${back2 ? ' and back' : ''}`, subtitle: `${a0.carrierName} ${a0.number}`, startDate: a0.departAt, endDate: back2 ? back2.segments.at(-1).arriveAt : z0.arriveAt, people: adults };
        const [fn, ...ln] = who.name.split(' ');
        const travelers = Array.from({ length: adults }, (_, k) => ({ firstName: k ? pick(r, FIRST) : fn, lastName: k ? ln.join(' ') : ln.join(' '), dob: '1990-05-14', gender: 'M' }));
        details = { offer: sell, travelers, contact: { email: who.email, countryCode: '+260', phone: '971234567' }, seats: [], seatFee: 0, seatPurchase: true, fare: sellTotal, sellTotal };
      } else {
        const city = pick(r, CITIES);
        const nights = randInt(r, 1, 4);
        const out = new Date(start.getTime() + nights * 864e5);
        const q = { cityCode: city, checkIn: ymd(start), checkOut: ymd(out), adults: randInt(r, 1, 3), rooms: 1 };
        const hotels = await mockHotels.searchHotels(q);
        const hotel = hotels[randInt(r, 0, hotels.length - 1)];
        const { offers, ...h } = hotel;
        const raw = offers[randInt(r, 0, offers.length - 1)];
        base = raw.price.total;
        sellTotal = round2(base * (1 + tierPct));
        const offer = { ...raw, price: { ...raw.price, total: sellTotal, perNight: Math.round(raw.price.perNight * (1 + tierPct)) } };
        route = city;
        summary = { title: h.name, subtitle: `${offer.room.type} · ${offer.board}`, startDate: q.checkIn, endDate: q.checkOut, people: q.adults };
        const [fn, ...ln] = who.name.split(' ');
        details = { hotel: h, offer, query: q, guest: { title: 'MR', firstName: fn, lastName: ln.join(' '), email: who.email, phone: '+260971234567' }, sellTotal };
      }
      const cancelled = r() < 0.1;
      const commission = agent ? round2(base * agent.commissionPct / 100) : 0;
      const customerTotal = round2(sellTotal + serviceFee);
      const refund = cancelled ? round2(type === 'flight' ? customerTotal * (1 - s.flightCancelFeePct / 100) : (details.offer.cancellation?.refundable ? customerTotal : 0)) : null;
      details.pay = { mode: paymentMode, serviceFee, last4: '1111', customerTotal, walletDebit: paymentMode === 'wallet' ? sellTotal : undefined };
      const providerRef = code(r, type === 'flight' ? 6 : 8);
      insBooking.run(ref, agent ? agent.id : who.id, type, cancelled ? 'cancelled' : 'confirmed', 'mock', `DEMO-${code(r, 8)}`, providerRef, customerTotal, 'ZMW',
        JSON.stringify(summary), JSON.stringify(details), refund, created, cancelled ? created : null,
        agent ? agent.id : null, agent ? who.id : null, who.name, who.email, agent ? 'agent' : 'direct', round2(base), round2(sellTotal - base), serviceFee, commission, paymentMode, route, ymd(start));
      if (agent) {
        if (paymentMode === 'wallet') txn(agent, 'booking', -sellTotal, ref, 'Booking paid from wallet', created);
        if (commission) txn(agent, 'commission', commission, ref, `Commission ${agent.commissionPct}%`, created);
        if (paymentMode === 'card' && serviceFee) txn(agent, 'service_fee', serviceFee, ref, 'Service fee from card payment', created);
        if (cancelled) {
          if (paymentMode === 'wallet') txn(agent, 'refund', round2(refund * sellTotal / customerTotal), ref, 'Cancellation refund', created);
          if (commission) txn(agent, 'commission_reversal', -commission, ref, 'Commission reversed', created);
        }
        if (agent.balance < 10000) txn(agent, 'topup', 40000, null, 'Mobile money top-up', created);
      }
      if (!agent) {
        insPts.run(who.id, Math.floor(customerTotal / 100), 'earn', ref, 'Booking reward', created);
        if (cancelled) insPts.run(who.id, -Math.floor(customerTotal / 100), 'reverse', ref, 'Reward reversed', created);
      }
      for (let k = 0; k < randInt(r, 5, 12); k++) insSearch.run(agent ? agent.id : who.id, type, route, created);
    }
  }
  for (const a of agents) db.prepare('UPDATE agents SET wallet_balance = ? WHERE user_id = ?').run(a.balance, a.id);

  const insPromo = db.prepare('INSERT OR IGNORE INTO promo_codes (code, description, type, value, min_total, max_discount, applies_to, max_uses, expires_at) VALUES (?,?,?,?,?,?,?,?,?)');
  const nextMonth = ymd(new Date(now.getTime() + 45 * 864e5));
  insPromo.run('WELCOME10', '10% off your first trip, up to K600', 'percent', 10, 1500, 600, 'all', null, nextMonth);
  insPromo.run('FLY100', 'K100 off flights above K2,000', 'flat', 100, 2000, null, 'flight', 200, nextMonth);
  insPromo.run('STAY8', '8% off lodge and hotel stays, up to K800', 'percent', 8, 1500, 800, 'hotel', null, nextMonth);

  const adminId = db.prepare("SELECT id FROM users WHERE role='admin' LIMIT 1").get()?.id;
  const sampleRef = db.prepare("SELECT ref, user_id FROM bookings WHERE channel = 'direct' ORDER BY created_at DESC LIMIT 1").get();
  if (sampleRef) {
    const t = db.prepare('INSERT INTO tickets (user_id, booking_ref, subject, status) VALUES (?,?,?,?)').run(sampleRef.user_id, sampleRef.ref, 'Need to change the name spelling', 'open');
    db.prepare('INSERT INTO ticket_messages (ticket_id, user_id, author_role, body) VALUES (?,?,?,?)').run(Number(t.lastInsertRowid), sampleRef.user_id, 'customer', 'The last name on the ticket has a spelling mistake. Can you correct it before the flight?');
    if (adminId) db.prepare('INSERT INTO audit (user_id, user_name, action, entity, entity_id, meta) VALUES (?,?,?,?,?,?)').run(adminId, 'Platform Admin', 'settings.reviewed', 'settings', null, null);
  }
  db.exec('COMMIT');
  console.log('Demo data loaded: 4 agents, customers and ~60 days of bookings.');
  console.log('  admin    admin@skyline.test    / Admin@12345\n  agent    agent@skyline.test    / Agent@12345\n  customer customer@skyline.test / Customer@12345');
  return true;
}

if (process.argv[1] && process.argv[1].endsWith('seed.js')) {
  ensureAdmin();
  await seedDemo({ force: true });
}
