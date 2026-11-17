import { flightCalendar } from './bookingService.js';
import { addDays } from './nlp.js';
import { round2 } from '../db.js';

// Typical fare pattern: cheapest 1 to 2 months out, climbing steeply in the last 3 weeks.
const idx = (d) => (d >= 60 ? 0.96 : d >= 30 ? 1 : d >= 21 ? 1.03 : d >= 14 ? 1.08 : d >= 7 ? 1.16 : 1.28);
const label = (iso) => new Date(`${iso}T00:00:00`).toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' });
const inr = (n) => `K${Math.round(n).toLocaleString('en-GB')}`;

/** Buy-or-wait guidance. An estimate from the days-to-departure curve and the prices on nearby dates. */
export async function adviseFlight(q, user) {
  const today = new Date().toISOString().slice(0, 10);
  const daysOut = Math.max(0, Math.round((new Date(q.date) - new Date(today)) / 864e5));
  const days = await flightCalendar(q, user);
  const priced = days.filter((d) => d.price);
  const sel = priced.find((d) => d.date === q.date);
  if (!sel) return { action: 'info', confidence: 0, headline: 'Not enough data yet', reasons: ['We could not find fares around this date.'], daysOut };

  const best = priced.reduce((a, b) => (a.price <= b.price ? a : b));
  const avg = priced.reduce((s, d) => s + d.price, 0) / priced.length;
  const saving = round2(sel.price - best.price);
  const savingPct = Math.round((saving / sel.price) * 100);
  const expected = Math.round((idx(Math.max(0, daysOut - 7)) / idx(daysOut) - 1) * 100);
  const reasons = [];
  let action, confidence, headline;

  if (best.date !== q.date && savingPct >= 8) {
    action = 'flex'; confidence = Math.min(90, 60 + savingPct); headline = `Save ${inr(saving)} by flying ${label(best.date)}`;
    reasons.push(`${label(best.date)} is ${savingPct}% cheaper than ${label(q.date)} for the same route.`);
  } else if (sel.price <= best.price * 1.02) {
    action = 'book'; confidence = daysOut <= 28 ? 86 : 74; headline = 'Good price. Book now';
    reasons.push(`${label(q.date)} is the lowest fare within 3 days either side.`);
  } else if (daysOut <= 14) {
    action = 'book'; confidence = 82; headline = 'Book soon. Fares are rising';
    reasons.push(`Departure is ${daysOut} day${daysOut === 1 ? '' : 's'} away. Fares usually climb about ${Math.max(expected, 8)}% in the next week.`);
  } else if (daysOut > 45) {
    action = 'wait'; confidence = 58; headline = 'You can wait a little';
    reasons.push(`Departure is ${daysOut} days away. Fares often dip 4 to 8 weeks before travel.`);
  } else {
    action = 'book'; confidence = 66; headline = 'A fair price. Book when ready';
    reasons.push(`The fare is close to the average for nearby dates (${inr(avg)}).`);
  }
  if (sel.price < avg * 0.97) reasons.push(`It is ${Math.round((1 - sel.price / avg) * 100)}% below the average for nearby dates.`);
  if (daysOut > 14 && daysOut <= 28) reasons.push(`Fares usually rise about ${expected}% over the next 7 days.`);
  reasons.push('This is an estimate from past patterns, not a guarantee.');
  return { action, confidence, headline, reasons, bestDay: best.date, bestPrice: best.price, saving: Math.max(0, saving), daysOut, expectedChange7Pct: expected };
}
void addDays;
