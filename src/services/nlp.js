import { PLACES } from '../data/places.js';
import { config } from '../config.js';

const ALIASES = { LVI: ['vic falls zambia'], VFA: ['vic falls'], MFU: ['south luangwa', 'luangwa'], NLA: ['copperbelt', 'kitwe'], JNB: ['joburg', 'jozi'], DAR: ['dar'], ADD: ['addis'], JFK: ['nyc', 'new york city'], DEL: ['new delhi'], BOM: ['bombay'] };
const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];
const DAYS = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];

export const addDays = (iso, n) => { const d = new Date(`${iso}T00:00:00Z`); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };
const dow = (iso) => new Date(`${iso}T00:00:00Z`).getUTCDay();
const ymd = (y, m, d) => `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
const nextWeekday = (today, w) => { let n = (w - dow(today) + 7) % 7; if (n === 0) n = 7; return addDays(today, n); };

/** Upcoming date for a day and month. Rolls to next year when it has already passed. */
function fromDayMonth(today, day, month) {
  const y = Number(today.slice(0, 4));
  let d = ymd(y, month, day);
  if (Number.isNaN(Date.parse(d)) || new Date(`${d}T00:00:00Z`).getUTCDate() !== day) return null;
  if (d < today) d = ymd(y + 1, month, day);
  return d;
}

function findPlaces(text) {
  const lower = text.toLowerCase();
  const hits = [];
  for (const p of PLACES) {
    const names = [p.city.toLowerCase(), ...(ALIASES[p.code] || [])];
    for (const n of names) {
      const m = new RegExp(`\\b${n.replace(/\s+/g, '\\s+')}\\b`).exec(lower);
      if (m) { hits.push({ code: p.code, city: p.city, index: m.index }); break; }
    }
    if (!hits.some((h) => h.code === p.code)) {
      const m = new RegExp(`\\b${p.code}\\b`).exec(text);
      if (m) hits.push({ code: p.code, city: p.city, index: m.index });
    }
  }
  return hits.sort((a, b) => a.index - b.index);
}

function findDates(t, today) {
  const out = [];
  const add = (index, date) => { if (date) out.push({ index, date }); };
  let m;
  const rx = (re, fn) => { re.lastIndex = 0; while ((m = re.exec(t))) fn(m); };
  rx(/\bday after tomorrow\b/g, (x) => add(x.index, addDays(today, 2)));
  rx(/\btomorrow\b/g, (x) => { if (!/day after tomorrow/.test(t.slice(Math.max(0, x.index - 10), x.index + 9))) add(x.index, addDays(today, 1)); });
  rx(/\btoday\b/g, (x) => add(x.index, today));
  rx(/\b(?:this|next|on|coming)?\s*(sunday|monday|tuesday|wednesday|thursday|friday|saturday)\b/g, (x) => add(x.index, nextWeekday(today, DAYS.indexOf(x[1]))));
  rx(/\b(?:this\s+)?weekend\b/g, (x) => add(x.index, nextWeekday(today, 6)));
  rx(/\bin\s+(\d{1,3})\s+days?\b/g, (x) => add(x.index, addDays(today, Number(x[1]))));
  rx(/\bnext\s+week\b/g, (x) => add(x.index, addDays(today, 7)));
  rx(/\bnext\s+month\b/g, (x) => add(x.index, addDays(today, 30)));
  rx(/\b(\d{1,2})(?:st|nd|rd|th)?\s+(?:of\s+)?(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\b/g, (x) => add(x.index, fromDayMonth(today, Number(x[1]), MONTHS.indexOf(x[2]) + 1)));
  rx(/\b(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\s+(\d{1,2})(?:st|nd|rd|th)?\b/g, (x) => add(x.index, fromDayMonth(today, Number(x[2]), MONTHS.indexOf(x[1]) + 1)));
  rx(/\b(\d{1,2})\/(\d{1,2})(?:\/(\d{2,4}))?\b/g, (x) => {
    const day = Number(x[1]), month = Number(x[2]);
    if (month > 12) return;
    if (x[3]) { const y = x[3].length === 2 ? 2000 + Number(x[3]) : Number(x[3]); add(x.index, ymd(y, month, day)); } else add(x.index, fromDayMonth(today, day, month));
  });
  const seen = new Set();
  return out.sort((a, b) => a.index - b.index).filter((d) => (seen.has(d.index) ? false : (seen.add(d.index), true)));
}

export function parseTrip(raw, today = new Date().toISOString().slice(0, 10)) {
  const text = String(raw || '').slice(0, 400).replace(/(\d),(\d{3})/g, '$1$2').replace(/[K]/g, ' ');
  const t = text.toLowerCase().replace(/[,;]/g, ' ').replace(/\s+/g, ' ');
  const out = { intent: 'none', origin: null, destination: null, date: null, returnDate: null, nights: null, adults: null, cabin: null, nonStop: false, budget: null, engine: 'rules' };

  const hotelWord = /\b(hotel|hotels|stay|room|rooms|resort|accommodation|lodging)\b/.test(t);
  const flightWord = /\b(flight|flights|fly|flying|ticket|tickets|airfare|plane)\b/.test(t);
  const places = findPlaces(text);
  const toFrom = /\bto\s+\S+(?:\s+\S+)?\s+from\s+/.test(t) && places.length >= 2;
  if (places.length >= 2) {
    const [a, b] = places;
    out.origin = toFrom ? b.code : a.code; out.destination = toFrom ? a.code : b.code;
  } else if (places.length === 1) {
    out.destination = places[0].code;
    if (/\bfrom\s+/.test(t.slice(0, places[0].index + 1).slice(-12)) && !hotelWord) { out.origin = places[0].code; out.destination = null; }
  }
  if (places.length) out.intent = hotelWord ? (places.length >= 2 || flightWord ? 'both' : 'hotel') : 'flight';
  else out.intent = hotelWord ? 'hotel' : flightWord ? 'flight' : 'none';

  if (out.intent === 'flight' && !flightWord && places.length === 1 && /\bnights?\b/.test(t)) out.intent = 'hotel';

  const dates = findDates(t, today);
  if (dates[0]) out.date = dates[0].date;
  if (dates[1] && dates[1].date >= dates[0].date) out.returnDate = dates[1].date;

  let m;
  if ((m = /\bfor\s+(\d{1,2})\s+nights?\b/.exec(t))) out.nights = Number(m[1]);
  else if ((m = /\b(\d{1,2})\s*-?\s*nights?\b/.exec(t))) out.nights = Number(m[1]);
  else if ((m = /\b(?:for\s+)?(\d{1,2})\s*-?\s*days?\b/.exec(t)) && !/in\s+\d+\s+days/.test(t)) out.nights = Math.max(1, Number(m[1]) - 1);
  else if (/\bweekend\b/.test(t)) out.nights = 2;
  if (out.nights && out.date && !out.returnDate) out.returnDate = addDays(out.date, out.nights);
  if (out.date && out.returnDate && !out.nights) out.nights = Math.round((new Date(out.returnDate) - new Date(out.date)) / 864e5);

  if ((m = /\bfamily of (\d{1,2})\b/.exec(t)) || (m = /\b(\d{1,2})\s*(?:adults?|people|persons?|passengers?|travell?ers?|guests?|pax|of us)\b/.exec(t)) || (m = /\bfor\s+(\d{1,2})(?!\s*(?:nights?|days?|k\b|l\b|lakh|hours?))\b(?!\d)/.exec(t))) out.adults = Math.min(9, Math.max(1, Number(m[1])));
  else if (/\b(solo|alone|myself|just me)\b/.test(t)) out.adults = 1;
  else if (/\b(couple|honeymoon|two of us)\b/.test(t)) out.adults = 2;

  if (/\bbusiness\b/.test(t)) out.cabin = 'BUSINESS'; else if (/\bfirst class\b/.test(t)) out.cabin = 'FIRST'; else if (/\bpremium economy\b/.test(t)) out.cabin = 'PREMIUM_ECONOMY'; else if (/\beconomy\b/.test(t)) out.cabin = 'ECONOMY';
  out.nonStop = /\b(non.?stop|direct)\b/.test(t);

  if ((m = /\b(?:under|below|within|budget(?: of)?|max(?:imum)?|less than|upto|up to)\s*(\d+(?:\.\d+)?)\s*(k|l|lakh|lakhs)?\b/.exec(t))) {
    out.budget = Math.round(Number(m[1]) * (m[2] === 'k' ? 1000 : m[2] ? 100000 : 1));
  }
  return out;
}

/** What the person still needs to tell us. */
export function missingFields(p) {
  const missing = [];
  if (p.intent === 'flight' || p.intent === 'both') { if (!p.origin) missing.push('origin'); if (!p.destination) missing.push('destination'); }
  if (p.intent === 'hotel' && !p.destination) missing.push('destination');
  if (p.intent !== 'none' && !p.date) missing.push('date');
  return missing;
}

/** Optional upgrade: asks Claude to read the sentence. Falls back to the rules above on any problem. */
export async function parseTripSmart(text, today) {
  const base = parseTrip(text, today);
  if (!process.env.ANTHROPIC_API_KEY) return base;
  try {
    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-api-key': process.env.ANTHROPIC_API_KEY, 'anthropic-version': '2023-06-01' },
      body: JSON.stringify({
        model: process.env.ANTHROPIC_MODEL || 'claude-haiku-5-5', max_tokens: 300,
        system: `You extract trip search details. Today is ${today}. Reply with JSON only, no prose, using keys: intent ("flight","hotel","both","none"), origin (3-letter IATA or null), destination (3-letter IATA or null), date (YYYY-MM-DD or null), returnDate (YYYY-MM-DD or null), nights (number or null), adults (number or null), cabin ("ECONOMY","PREMIUM_ECONOMY","BUSINESS","FIRST" or null), nonStop (true or false), budget (rupees as number or null).`,
        messages: [{ role: 'user', content: String(text).slice(0, 400) }],
      }),
      signal: AbortSignal.timeout(8000),
    });
    if (!res.ok) return base;
    const body = await res.json();
    const j = JSON.parse(/\{[\s\S]*\}/.exec(body.content?.[0]?.text || '')?.[0] || '{}');
    const iata = (v) => (typeof v === 'string' && /^[A-Za-z]{3}$/.test(v) ? v.toUpperCase() : null);
    const date = (v) => (typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v) && v >= today ? v : null);
    const merged = { ...base, engine: 'claude' };
    if (['flight', 'hotel', 'both', 'none'].includes(j.intent)) merged.intent = j.intent;
    merged.origin = iata(j.origin) || base.origin; merged.destination = iata(j.destination) || base.destination;
    merged.date = date(j.date) || base.date; merged.returnDate = date(j.returnDate) || base.returnDate;
    if (Number.isInteger(j.adults) && j.adults >= 1 && j.adults <= 9) merged.adults = j.adults;
    if (['ECONOMY', 'PREMIUM_ECONOMY', 'BUSINESS', 'FIRST'].includes(j.cabin)) merged.cabin = j.cabin;
    if (typeof j.nonStop === 'boolean') merged.nonStop = j.nonStop;
    if (Number.isFinite(j.budget) && j.budget > 0) merged.budget = Math.round(j.budget);
    if (Number.isFinite(j.nights) && j.nights > 0 && j.nights <= 30) merged.nights = j.nights;
    return merged;
  } catch { return base; }
}
export const claudeEnabled = () => Boolean(process.env.ANTHROPIC_API_KEY);
void config;
