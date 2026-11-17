import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';

process.env.DB_PATH = ':memory:';
process.env.USE_MOCK = 'true';
process.env.AMADEUS_CLIENT_ID = '';
const { app } = await import('../src/app.js');

let server, base, token;
const day = (n) => new Date(Date.now() + n * 864e5).toISOString().slice(0, 10);
const call = async (path, { method = 'GET', body, auth } = {}) => {
  const res = await fetch(base + path, { method, headers: { 'content-type': 'application/json', ...(auth ? { authorization: `Bearer ${auth}` } : {}) }, body: body && JSON.stringify(body) });
  return { status: res.status, json: await res.json() };
};
const card = { number: '4111 1111 1111 1111', expMonth: 12, expYear: 2040, cvv: '123', holder: 'Asha Verma' };

before(async () => { server = app.listen(0); base = `http://localhost:${server.address().port}/api`; });
after(() => server.close());

test('register and sign in', async () => {
  const r = await call('/auth/register', { method: 'POST', body: { name: 'Asha Verma', email: 'asha@example.com', password: 'secret-pass-1' } });
  assert.equal(r.status, 201);
  token = r.json.token;
  assert.equal((await call('/auth/login', { method: 'POST', body: { email: 'asha@example.com', password: 'wrong' } })).status, 401);
});

test('validation rejects bad search', async () => {
  const r = await call(`/flights/search?origin=DEL&destination=DEL&date=${day(10)}`);
  assert.equal(r.status, 400);
  assert.ok(r.json.error.fields.destination);
});

test('flight: search, price, seatmap, book, cancel', async () => {
  const s = await call(`/flights/search?origin=LUN&destination=LVI&date=${day(20)}&adults=1`);
  assert.equal(s.status, 200);
  assert.ok(s.json.offers.length > 3);
  const offer = s.json.offers[0];
  const p = await call(`/flights/offers/${offer.id}/price`, { method: 'POST' });
  assert.equal(p.status, 200);
  const m = await call(`/flights/offers/${offer.id}/seatmap`);
  const seg = m.json.seatmaps[0];
  const free = seg.rows.flatMap((r) => Object.values(r.cells)).find((c) => c.available);
  const body = {
    offerId: offer.id, travelers: [{ firstName: 'Asha', lastName: 'Verma', dob: '1991-04-18', gender: 'F' }],
    contact: { email: 'asha@example.com', countryCode: '+260', phone: '971234567' },
    seats: [{ segmentId: seg.segmentId, travelerIndex: 0, number: free.number }], card,
  };
  assert.equal((await call('/bookings/flights', { method: 'POST', body })).status, 401);
  const b = await call('/bookings/flights', { method: 'POST', body, auth: token });
  assert.equal(b.status, 201);
  assert.equal(b.json.status, 'confirmed');
  assert.equal(b.json.total, offer.price.total + free.price);
  const declined = await call('/bookings/flights', { method: 'POST', body: { ...body, card: { ...card, number: '4000 0000 0000 0002' } }, auth: token });
  assert.equal(declined.status, 402);
  const list = await call('/bookings', { auth: token });
  assert.equal(list.json.bookings.length, 1);
  const c = await call(`/bookings/${b.json.ref}/cancel`, { method: 'POST', auth: token });
  assert.equal(c.json.status, 'cancelled');
  assert.ok(c.json.refundAmount > 0);
  assert.equal((await call(`/bookings/${b.json.ref}/cancel`, { method: 'POST', auth: token })).status, 409);
});

test('hotel: search, refresh, book', async () => {
  const s = await call(`/hotels/search?cityCode=LVI&checkIn=${day(30)}&checkOut=${day(33)}&adults=2&rooms=1`);
  assert.equal(s.status, 200);
  const offer = s.json.hotels[0].offers[0];
  assert.equal((await call(`/hotels/offers/${offer.id}`)).status, 200);
  const b = await call('/bookings/hotels', { method: 'POST', auth: token, body: { offerId: offer.id, guest: { firstName: 'Asha', lastName: 'Verma', email: 'asha@example.com', phone: '+260971234567' }, card } });
  assert.equal(b.status, 201);
  assert.equal(b.json.summary.title, s.json.hotels[0].name);
});

test('bookings are private to their owner', async () => {
  const other = await call('/auth/register', { method: 'POST', body: { name: 'Other Person', email: 'other@example.com', password: 'another-pass-1' } });
  const mine = await call('/bookings', { auth: token });
  const r = await call(`/bookings/${mine.json.bookings[0].ref}`, { auth: other.json.token });
  assert.equal(r.status, 404);
});
