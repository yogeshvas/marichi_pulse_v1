import { db } from '../db.js';
import { PLACES, byCode } from '../data/places.js';
import { parseTripSmart, missingFields, addDays, claudeEnabled } from './nlp.js';
import { getSettings } from './settings.js';
import { publicOffers, pointsBalance } from './rewards.js';

const today = () => new Date().toISOString().slice(0, 10);
const city = (c) => byCode(c)?.city || c;
const inr = (n) => `K${Math.round(n).toLocaleString('en-GB')}`;

export const flightLink = (p) => `#/flights?${new URLSearchParams({ origin: p.origin, destination: p.destination, date: p.date, adults: String(p.adults || 1), cabin: p.cabin || 'ECONOMY', ...(p.returnDate ? { returnDate: p.returnDate } : {}) })}`;
export const hotelLink = (p) => {
  const checkIn = p.date, checkOut = p.returnDate && p.returnDate > p.date ? p.returnDate : addDays(p.date, p.nights || 2);
  return `#/hotels?${new URLSearchParams({ cityCode: p.destination, cityName: city(p.destination), checkIn, checkOut, adults: String(p.adults || 2), rooms: '1' })}`;
};
export const plannerLink = (p) => `#/planner?${new URLSearchParams({ origin: p.origin || 'LUN', destination: p.destination, date: p.date, nights: String(p.nights || 3), adults: String(p.adults || 2), ...(p.budget ? { budget: String(p.budget) } : {}) })}`;

const ASK = {
  origin: 'Where are you flying from?', destination: 'Where would you like to go?', date: 'When do you want to travel? You can say things like "next Friday" or "5 Dec".',
};

async function claudeAnswer(message, user) {
  const s = getSettings();
  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-api-key': process.env.ANTHROPIC_API_KEY, 'anthropic-version': '2023-06-01' },
    body: JSON.stringify({
      model: process.env.ANTHROPIC_MODEL || 'claude-haiku-5-5', max_tokens: 350,
      system: `You are Pulse, the assistant for Marichi Pulse, a flight and hotel booking site. Be brief and friendly. Facts you may use: flights cancel with a ${s.flightCancelFeePct}% fee; hotel rooms are refundable only when the room says free cancellation; customers earn 1 Pulse Point per K100 and can use points for up to 10% of a booking; support is at ${s.supportEmail}. Never invent prices, availability or bookings. If asked for those, tell the person to search on the site. ${user ? `The customer is ${user.name}.` : ''}`,
      messages: [{ role: 'user', content: message.slice(0, 500) }],
    }),
    signal: AbortSignal.timeout(9000),
  });
  if (!res.ok) throw new Error('claude');
  return (await res.json()).content?.[0]?.text?.trim();
}

export async function chat(user, message) {
  const text = String(message || '').trim().slice(0, 500);
  const t = text.toLowerCase();
  const s = getSettings();
  const reply = (r, actions = [], extra = {}) => ({ reply: r, actions, engine: 'rules', ...extra });
  if (!text) return reply('Ask me to find a flight or hotel, for example "Lusaka to Livingstone next Friday for 2".');

  if (/^(hi|hello|hey|namaste|good (morning|evening|afternoon))\b/.test(t) && t.length < 25) {
    return reply(`Hi${user ? ` ${user.name.split(' ')[0]}` : ''}! I can find flights and hotels, plan a whole trip, check your bookings or explain refunds. Where would you like to go?`);
  }

  if (/\b(my (trips?|bookings?|tickets?)|upcoming|booked)\b/.test(t)) {
    if (!user) return reply('Sign in and I can show your trips.', [{ label: 'Open My trips', href: '#/trips' }]);
    const rows = db.prepare("SELECT ref, summary, start_date, type FROM bookings WHERE (user_id = ? OR lower(customer_email) = lower(?)) AND status = 'confirmed' AND start_date >= date('now') ORDER BY start_date LIMIT 3").all(user.id, user.email);
    if (!rows.length) return reply('You have no upcoming trips. Want to plan one?', [{ label: 'Search flights', href: '#/' }, { label: 'Plan a trip', href: '#/planner' }]);
    return reply(`You have ${rows.length} upcoming trip${rows.length > 1 ? 's' : ''}:\n${rows.map((r) => `• ${JSON.parse(r.summary).title} on ${r.start_date}`).join('\n')}`, rows.map((r) => ({ label: `Open ${r.ref}`, href: `#/trips/${r.ref}` })));
  }

  if (/\b(points?|rewards?|loyalty)\b/.test(t)) {
    if (!user) return reply('You earn 1 Pulse Point for every K100 you spend. Each point is worth K1 and can cover up to 10% of a booking. Sign in to see your balance.');
    const b = pointsBalance(user.id);
    return reply(`You have ${b.toLocaleString('en-GB')} Pulse Points, worth ${inr(b)}. You can use them for up to 10% of a booking at checkout.`, [{ label: 'See my account', href: '#/account' }]);
  }

  if (/\b(mobile money|momo|mtn|airtel|zamtel|pay(ment)?s?|how (do|can) i pay)\b/.test(t) && !parseHasTrip(t)) {
    return reply('You can pay by card or with mobile money: MTN Mobile Money, Airtel Money or Zamtel Kwacha. For mobile money, enter your number at the payment step, then approve the prompt on your phone. All prices are in Zambian Kwacha (ZMW).', [{ label: 'Search flights', href: '#/' }]);
  }

  if (/\b(promo|offers?|coupon|discount|deal|code)s?\b/.test(t)) {
    const o = publicOffers();
    return o.length ? reply(`Current offers:\n${o.slice(0, 4).map((x) => `• ${x.code}: ${x.description}`).join('\n')}\nApply a code at the payment step.`, [{ label: 'Search flights', href: '#/' }]) : reply('There are no promo codes running right now.');
  }

  if (/\b(cancel|refund|change|reschedule)\b/.test(t) && !/\b(flight|hotel)s? (from|to|in)\b/.test(t)) {
    return reply(`Flights can be cancelled from My trips. A ${s.flightCancelFeePct}% fee applies and the rest is refunded. Hotel rooms are refunded in full only when they show "Free cancellation" and the deadline has not passed. Agent commission and points are reversed automatically.`, [{ label: 'Go to My trips', href: '#/trips' }]);
  }

  if (/\b(help|support|agent|human|complain|problem|issue)\b/.test(t) && !parseHasTrip(t)) {
    return reply(`I can raise a support request for you. You can also email ${s.supportEmail}.`, [{ label: 'Open support', href: '#/account' }]);
  }

  if (/\b(plan|package|bundle|trip planner|itinerary)\b/.test(t) || /\bflight and hotel\b/.test(t)) {
    const p = await parseTripSmart(text, today());
    if (p.destination && p.date) return reply(`I will put together flight and hotel packages for ${city(p.destination)} from ${p.date}${p.nights ? ` for ${p.nights} nights` : ''}${p.budget ? ` within ${inr(p.budget)}` : ''}.`, [{ label: 'See packages', href: plannerLink(p) }], { parsed: p, engine: p.engine });
  }

  const p = await parseTripSmart(text, today());
  if (p.intent !== 'none' && (p.destination || p.origin)) {
    const missing = missingFields(p);
    if (missing.length) return reply(ASK[missing[0]], [], { parsed: p, engine: p.engine });
    const bits = [`${p.intent === 'hotel' ? 'Hotel in' : p.intent === 'both' ? 'Trip to' : 'Flight to'} ${city(p.destination)}${p.origin && p.intent !== 'hotel' ? ` from ${city(p.origin)}` : ''}`, p.date, p.returnDate ? `back ${p.returnDate}` : null, p.adults ? `${p.adults} traveller${p.adults > 1 ? 's' : ''}` : null, p.cabin ? p.cabin.toLowerCase().replace('_', ' ') : null, p.nonStop ? 'non-stop' : null, p.budget ? `under ${inr(p.budget)}` : null].filter(Boolean);
    const actions = [];
    if (p.intent !== 'hotel') actions.push({ label: 'Show flights', href: flightLink(p) });
    if (p.intent !== 'flight') actions.push({ label: 'Show hotels', href: hotelLink(p) });
    if (p.intent === 'both' || (p.destination && p.date && p.intent === 'flight' && p.returnDate)) actions.push({ label: 'Plan flight and hotel', href: plannerLink(p) });
    return reply(`Got it: ${bits.join(', ')}.`, actions, { parsed: p, engine: p.engine });
  }

  if (claudeEnabled()) {
    try { const a = await claudeAnswer(text, user); if (a) return { reply: a, actions: [], engine: 'claude' }; } catch { /* fall through */ }
  }
  return reply('I can search flights and hotels, plan a trip, show offers or your bookings. Try "Lusaka to Livingstone next Friday for 2" or "hotel in Livingstone this weekend".');
}
const parseHasTrip = (t) => PLACES.some((p) => t.includes(p.city.toLowerCase()));

/** "Picked for you": from this person's history, or what is trending in searches. */
export function suggestionsFor(user) {
  const out = [];
  const d = (n) => addDays(today(), n);
  if (user) {
    const flights = db.prepare("SELECT route, COUNT(*) n FROM bookings WHERE user_id = ? AND type = 'flight' AND route IS NOT NULL AND status = 'confirmed' GROUP BY route ORDER BY n DESC LIMIT 1").get(user.id);
    if (flights) { const [o, de] = flights.route.split('-'); out.push({ kind: 'repeat', title: `${city(o)} to ${city(de)} again`, subtitle: `You have flown this ${flights.n} time${flights.n > 1 ? 's' : ''}`, href: flightLink({ origin: o, destination: de, date: d(21) }) }); }
    const stays = db.prepare("SELECT route, COUNT(*) n FROM bookings WHERE user_id = ? AND type = 'hotel' AND route IS NOT NULL AND status = 'confirmed' GROUP BY route ORDER BY n DESC LIMIT 1").get(user.id);
    if (stays) out.push({ kind: 'repeat', title: `Stay in ${city(stays.route)} again`, subtitle: 'You booked a hotel here before', href: hotelLink({ destination: stays.route, date: d(21), nights: 3, adults: 2 }) });
    const bal = pointsBalance(user.id);
    if (bal >= 100) out.push({ kind: 'points', title: `${bal.toLocaleString('en-GB')} points to use`, subtitle: `Worth ${inr(bal)} off your next trip`, href: '#/' });
  }
  const trending = db.prepare("SELECT key, COUNT(*) n FROM search_log WHERE kind = 'flight' AND date(created_at) >= date('now','-14 day') GROUP BY key ORDER BY n DESC LIMIT 4").all();
  for (const t of trending) {
    const [o, de] = t.key.split('-');
    if (!byCode(o) || !byCode(de) || out.some((x) => x.href.includes(`destination=${de}`) && x.href.includes(`origin=${o}`))) continue;
    out.push({ kind: 'trending', title: `${city(o)} to ${city(de)}`, subtitle: `Trending: ${t.n} searches this fortnight`, href: flightLink({ origin: o, destination: de, date: d(14) }) });
  }
  return out.slice(0, 4);
}
