import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';

process.env.DB_PATH = ':memory:';
process.env.USE_MOCK = 'true';
process.env.AMADEUS_CLIENT_ID = '';
process.env.ADMIN_EMAIL = 'boss@example.com';
process.env.ADMIN_PASSWORD = 'Boss-pass-123';
const { app } = await import('../src/app.js');
const { ensureAdmin } = await import('../src/seed.js');
ensureAdmin();

let server, base;
const day = (n) => new Date(Date.now() + n * 864e5).toISOString().slice(0, 10);
const call = async (path, { method = 'GET', body, auth } = {}) => {
  const res = await fetch(base + path, { method, headers: { 'content-type': 'application/json', ...(auth ? { authorization: `Bearer ${auth}` } : {}) }, body: body && JSON.stringify(body) });
  const text = await res.text();
  return { status: res.status, json: text.startsWith('{') ? JSON.parse(text) : text };
};
const card = { number: '4111 1111 1111 1111', expMonth: 12, expYear: 2040, cvv: '123', holder: 'Test' };
let admin, agentTok, agentId, cust;

before(async () => { server = app.listen(0); base = `http://localhost:${server.address().port}/api`; });
after(() => server.close());

test('admin signs in; customers and anonymous users are locked out', async () => {
  admin = (await call('/auth/login', { method: 'POST', body: { email: 'boss@example.com', password: 'Boss-pass-123' } })).json.token;
  assert.ok(admin);
  cust = (await call('/auth/register', { method: 'POST', body: { name: 'Plain Customer', email: 'plain@example.com', password: 'customer-pass-1' } })).json.token;
  for (const p of ['/admin/agents', '/reports/overview', '/agent/wallet', '/bookings/manage']) {
    assert.equal((await call(p, { auth: cust })).status, 403, p);
    assert.equal((await call(p)).status, 401, p);
  }
});

test('agent applies, waits for approval, then books from the wallet', async () => {
  const reg = await call('/auth/register-agent', { method: 'POST', body: { name: 'Ravi Agent', email: 'ravi@agency.com', password: 'agent-pass-123', agency: 'Ravi Travels', phone: '+260971234567' } });
  assert.equal(reg.status, 201);
  agentTok = reg.json.token;
  assert.equal((await call('/agent/wallet', { auth: agentTok })).status, 403); // pending
  const list = await call('/admin/agents?status=pending', { auth: admin });
  agentId = list.json.agents[0].id;
  await call(`/admin/agents/${agentId}`, { method: 'PATCH', auth: admin, body: { status: 'active', commissionPct: 2, creditLimit: 0 } });
  await call(`/admin/agents/${agentId}/wallet`, { method: 'POST', auth: admin, body: { amount: 100000, note: 'Opening deposit' } });

  const s = await call(`/flights/search?origin=LUN&destination=LVI&date=${day(25)}&adults=1`, { auth: agentTok });
  const offer = s.json.offers[0];
  const cs = await call(`/flights/search?origin=LUN&destination=LVI&date=${day(25)}&adults=1`);
  assert.ok(cs.json.offers[0].price.total > offer.price.total, 'customers pay more than agents');

  const body = { offerId: offer.id, travelers: [{ firstName: 'Meera', lastName: 'Rao', dob: '1990-01-01', gender: 'F' }], contact: { email: 'meera@example.com', countryCode: '+260', phone: '971234567' }, agent: { newCustomer: { name: 'Meera Rao', email: 'meera@example.com' }, serviceFee: 500, paymentMode: 'wallet' } };
  const b = await call('/bookings/flights', { method: 'POST', auth: agentTok, body });
  assert.equal(b.status, 201, JSON.stringify(b.json));
  assert.equal(b.json.channel, 'agent');
  assert.equal(b.json.total, offer.price.total + 500);
  assert.ok(b.json.commission > 0);
  const w = await call('/agent/wallet', { auth: agentTok });
  assert.equal(Math.round(w.json.balance), Math.round(100000 - offer.price.total + b.json.commission));
  assert.equal((await call('/agent/customers', { auth: agentTok })).json.customers.length, 1);

  // other roles cannot see it
  assert.equal((await call(`/bookings/${b.json.ref}`, { auth: cust })).status, 404);
  assert.equal((await call(`/bookings/${b.json.ref}`, { auth: admin })).status, 200);

  const c = await call(`/bookings/${b.json.ref}/cancel`, { method: 'POST', auth: agentTok });
  assert.equal(c.json.status, 'cancelled');
  const w2 = await call('/agent/wallet', { auth: agentTok });
  assert.ok(w2.json.balance > w.json.balance - b.json.commission - 1 && w2.json.balance < 100000, 'refund credited, commission reversed');
});

test('wallet low blocks a booking and does not create it', async () => {
  const bal = (await call('/agent/wallet', { auth: agentTok })).json.balance;
  await call(`/admin/agents/${agentId}/wallet`, { method: 'POST', auth: admin, body: { amount: -(Math.floor(bal) - 50), note: 'Drain for test' } });
  const s = await call(`/hotels/search?cityCode=LVI&checkIn=${day(30)}&checkOut=${day(32)}&adults=2&rooms=1`, { auth: agentTok });
  const offer = s.json.hotels[0].offers[0];
  const before = (await call('/bookings/manage', { auth: agentTok })).json.total;
  const r = await call('/bookings/hotels', { method: 'POST', auth: agentTok, body: { offerId: offer.id, guest: { firstName: 'A', lastName: 'B', email: 'a@b.com', phone: '+260971234567' }, agent: { newCustomer: { name: 'A B' }, paymentMode: 'wallet' } } });
  assert.equal(r.status, 402);
  assert.equal(r.json.error.code, 'WALLET_LOW');
  assert.equal((await call('/bookings/manage', { auth: agentTok })).json.total, before);
});

test('reports are scoped and exportable; settings change prices', async () => {
  const a = await call('/reports/overview', { auth: agentTok });
  const all = await call('/reports/overview', { auth: admin });
  assert.equal(a.status, 200);
  assert.ok(all.json.kpis.bookings >= a.json.kpis.bookings);
  const csv = await call('/reports/sales?format=csv', { auth: admin });
  assert.ok(String(csv.json).startsWith('ref,created_at'));
  assert.equal((await call('/reports/agents', { auth: agentTok })).status, 403);

  const set = await call('/admin/settings', { auth: admin });
  await call('/admin/settings', { method: 'PUT', auth: admin, body: { ...set.json.settings, markupFlightPct: 10 } });
  const s1 = await call(`/flights/search?origin=LUN&destination=LVI&date=${day(25)}&adults=1`);
  assert.ok(s1.json.offers.length > 0);
  const audit = await call('/admin/audit', { auth: admin });
  assert.ok(audit.json.rows.some((r) => r.action === 'settings.updated'));
});

test('support ticket flow between customer and admin', async () => {
  const t = await call('/support', { method: 'POST', auth: cust, body: { subject: 'Need help with refund', message: 'Where is my refund?' } });
  assert.equal(t.status, 201);
  assert.equal((await call('/support', { auth: admin })).json.tickets.length, 1);
  assert.equal((await call(`/support/${t.json.id}/messages`, { method: 'POST', auth: admin, body: { body: 'Looking into it.' } })).status, 201);
  const th = await call(`/support/${t.json.id}`, { auth: cust });
  assert.equal(th.json.messages.length, 2);
});

test('promo codes and points reduce the price and are earned back', async () => {
  const code = 'TESTPROMO';
  assert.equal((await call('/admin/promos', { method: 'POST', auth: admin, body: { code, description: 'Test promo code', type: 'percent', value: 10, minTotal: 1000, appliesTo: 'flight' } })).status, 201);
  const s = await call(`/flights/search?origin=LUN&destination=LVI&date=${day(40)}&adults=1`, { auth: cust });
  const offer = s.json.offers[0];
  const q = await call('/checkout/quote', { method: 'POST', auth: cust, body: { kind: 'flight', offerId: offer.id, promoCode: code } });
  assert.equal(q.status, 200);
  assert.equal(Math.round(q.json.promoDiscount), Math.round(offer.price.total * 0.1));
  assert.equal((await call('/checkout/quote', { method: 'POST', auth: cust, body: { kind: 'hotel', offerId: offer.id, promoCode: code } })).status, 400);
  assert.equal((await call('/checkout/quote', { method: 'POST', auth: cust, body: { kind: 'flight', offerId: offer.id, promoCode: 'NOPE1234' } })).status, 400);

  const body = { offerId: offer.id, promoCode: code, usePoints: true, card, travelers: [{ firstName: 'Plain', lastName: 'Customer', dob: '1990-01-01', gender: 'M' }], contact: { email: 'plain@example.com', countryCode: '+260', phone: '971234567' } };
  const b = await call('/bookings/flights', { method: 'POST', auth: cust, body });
  assert.equal(b.status, 201, JSON.stringify(b.json));
  assert.equal(b.json.promoCode, code);
  assert.ok(b.json.discount >= Math.round(offer.price.total * 0.1 * 100) / 100 - 0.01);
  assert.equal(b.json.total, Math.round((offer.price.total - b.json.discount) * 100) / 100);
  assert.equal(b.json.pointsEarned, Math.floor(b.json.total / 100));
  const r = await call('/account/rewards', { auth: cust });
  assert.equal(r.json.points, b.json.pointsEarned);
  await call(`/bookings/${b.json.ref}/cancel`, { method: 'POST', auth: cust });
  assert.equal((await call('/account/rewards', { auth: cust })).json.points, 0);
  const cal = await call(`/flights/calendar?origin=LUN&destination=LVI&date=${day(40)}&adults=1`);
  assert.ok(cal.json.days.length >= 4 && cal.json.days.every((d) => d.price > 0));
  const ov = await call('/reports/overview', { auth: admin });
  assert.ok(ov.json.previous && 'revenue' in ov.json.previous);
});

test('natural language search, advisor, planner, insights and risk', async () => {
  const chat = await call('/ai/chat', { method: 'POST', body: { message: 'Lusaka to Livingstone next friday for 2 adults under 8000' } });
  assert.equal(chat.status, 200);
  assert.ok(chat.json.actions.some((a) => a.href.startsWith('#/flights?') && a.href.includes('origin=LUN') && a.href.includes('destination=LVI') && a.href.includes('adults=2')));
  assert.equal(chat.json.parsed.budget, 8000);
  const ask = await call('/ai/chat', { method: 'POST', body: { message: 'flight to Livingstone' } });
  assert.match(ask.json.reply, /from|when/i);
  const faq = await call('/ai/chat', { method: 'POST', body: { message: 'what is your refund policy' } });
  assert.match(faq.json.reply, /cancel/i);

  const adv = await call(`/ai/advice?origin=LUN&destination=LVI&date=${day(10)}&adults=1`);
  assert.equal(adv.status, 200);
  assert.ok(['book', 'wait', 'flex'].includes(adv.json.action));
  assert.ok(adv.json.reasons.length >= 2);

  const plan = await call('/ai/plan', { method: 'POST', auth: cust, body: { origin: 'LUN', destination: 'LVI', date: day(30), nights: 3, adults: 2, budget: 60000 } });
  assert.equal(plan.status, 200, JSON.stringify(plan.json));
  assert.ok(plan.json.options.length >= 1);
  const o = plan.json.options[0];
  assert.equal(Math.round(o.total), Math.round(o.flight.total + o.hotel.total));
  assert.equal((await call(`/flights/offers/${o.flight.id}/price`, { method: 'POST' })).status, 200);
  assert.equal((await call(`/hotels/offers/${encodeURIComponent(o.hotel.offerId)}`)).status, 200);

  const ins = await call('/reports/insights', { auth: admin });
  assert.equal(ins.status, 200);
  assert.ok(ins.json.insights.length >= 1);
  const ov = await call('/reports/overview', { auth: admin });
  assert.ok(Array.isArray(ov.json.forecast));

  const sug = await call('/ai/suggestions');
  assert.equal(sug.status, 200);
  const mine = await call('/bookings/manage?pageSize=1', { auth: admin });
  if (mine.json.rows.length) assert.ok((await call(`/bookings/${mine.json.rows[0].ref}`, { auth: admin })).json.risk.level);
});

test('mobile money: valid numbers pay, wrong network and declined numbers are refused', async () => {
  const s = await call(`/flights/search?origin=LUN&destination=NLA&date=${day(35)}&adults=1`, { auth: cust });
  const offer = s.json.offers[0];
  const base = { offerId: offer.id, travelers: [{ firstName: 'Mutale', lastName: 'Banda', dob: '1992-03-04', gender: 'F' }], contact: { email: 'plain@example.com', countryCode: '+260', phone: '971234567' } };
  const wrong = await call('/bookings/flights', { method: 'POST', auth: cust, body: { ...base, momo: { network: 'mtn', phone: '0971234567' } } });
  assert.equal(wrong.status, 400);
  assert.ok(wrong.json.error.fields['momo.phone']);
  const declined = await call('/bookings/flights', { method: 'POST', auth: cust, body: { ...base, momo: { network: 'airtel', phone: '0970000000' } } });
  assert.equal(declined.status, 402);
  const ok = await call('/bookings/flights', { method: 'POST', auth: cust, body: { ...base, momo: { network: 'airtel', phone: '+260 97 123 4567' } } });
  assert.equal(ok.status, 201, JSON.stringify(ok.json));
  assert.equal(ok.json.details.pay.method, 'momo');
  assert.equal(ok.json.details.pay.network, 'airtel');
  assert.equal(ok.json.currency, 'ZMW');
  assert.equal((await call('/bookings/flights', { method: 'POST', auth: cust, body: base })).status, 400);
});
