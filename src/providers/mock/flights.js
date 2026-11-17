import { rng, pick, randInt, code, addMinutes, randomId } from './util.js';
import { byCode, PLACES, regionOf } from '../../data/places.js';
import { AppError } from '../../errors.js';
import { config } from '../../config.js';

export const capabilities = { seatPurchase: true };

const CARRIERS = {
  zm: [['P0', 'Proflight Zambia', 'ATR 72-600'], ['4Z', 'Airlink', 'Embraer E145'], ['ZN', 'Zambia Airways', 'Airbus A319']],
  af: [['4Z', 'Airlink', 'Embraer E190'], ['KQ', 'Kenya Airways', 'Boeing 737-800'], ['ET', 'Ethiopian Airlines', 'Boeing 787-8'], ['SA', 'South African Airways', 'Airbus A320'], ['WB', 'RwandAir', 'Boeing 737-800']],
  int: [['EK', 'Emirates', 'Airbus A380'], ['QR', 'Qatar Airways', 'Airbus A350'], ['ET', 'Ethiopian Airlines', 'Boeing 787-8'], ['KQ', 'Kenya Airways', 'Boeing 787-8'], ['BA', 'British Airways', 'Boeing 777-300ER']],
};
const HUBS = { zm: ['LUN', 'NLA'], af: ['JNB', 'NBO', 'ADD', 'LUN'], int: ['DXB', 'DOH', 'ADD', 'NBO'] };
// Real world flight times in minutes for common routes.
const KNOWN = {
  'LUN-NLA': 55, 'LUN-LVI': 65, 'LUN-MFU': 60, 'LUN-SLI': 65, 'LUN-KMZ': 85, 'LUN-CIP': 60, 'LUN-MNR': 75, 'LUN-VFA': 75, 'LUN-HRE': 75, 'LUN-JNB': 130, 'LUN-CPT': 230,
  'LUN-NBO': 190, 'LUN-ADD': 255, 'LUN-DAR': 140, 'LUN-LLW': 70, 'LUN-WDH': 170, 'LUN-DXB': 400, 'LUN-DOH': 390, 'LUN-LHR': 650, 'LUN-JFK': 1000, 'LUN-DEL': 540, 'LUN-BOM': 430,
  'NLA-LVI': 110, 'LVI-JNB': 100, 'LVI-VFA': 15,
};
const RATE = { zm: { base: 1500, perMin: 16 }, af: { base: 2400, perMin: 24 }, int: { base: 4200, perMin: 30 } };
const CABIN_MULT = { ECONOMY: 1, PREMIUM_ECONOMY: 1.6, BUSINESS: 3.2, FIRST: 5 };

const regionOfPair = (a, b) => { const ra = regionOf(a), rb = regionOf(b); return ra === 'zm' && rb === 'zm' ? 'zm' : ra !== 'int' && rb !== 'int' ? 'af' : 'int'; };
const minutesBetween = (a, b, region, r) => KNOWN[`${a}-${b}`] || KNOWN[`${b}-${a}`] || { zm: 80, af: 190, int: 560 }[region] + randInt(r, -15, 40);

function leg(r, from, to, date, cabin) {
  const region = regionOfPair(from, to);
  const base = minutesBetween(from, to, region, r);
  const stops = region === 'zm' ? 0 : r() < 0.3 ? 1 : 0;
  const [cc, cname, craft] = pick(r, CARRIERS[region]);
  const dep = `${date}T${String(randInt(r, 5, 21)).padStart(2, '0')}:${pick(r, ['00', '10', '15', '20', '30', '40', '45', '55'])}:00`;
  const hub = pick(r, PLACES.filter((p) => HUBS[region].includes(p.code) && p.code !== from && p.code !== to).map((p) => p.code).concat(HUBS[region][0] === from || HUBS[region][0] === to ? ['JNB'] : []));
  const parts = stops ? [[from, hub, Math.round(base * 0.55)], [hub, to, Math.round(base * 0.55)]] : [[from, to, base]];
  let t = dep;
  const segments = parts.map(([f, tt, mins], i) => {
    const departAt = t, arriveAt = addMinutes(departAt, mins);
    t = addMinutes(arriveAt, randInt(r, 70, 160));
    return { id: String(i + 1), from: f, to: tt, departAt, arriveAt, terminalFrom: String(randInt(r, 1, 2)), carrier: cc, carrierName: cname, number: `${cc} ${randInt(r, 100, 989)}`, aircraft: craft, durationMinutes: mins };
  });
  const last = segments.at(-1);
  const durationMinutes = (new Date(`${last.arriveAt}Z`) - new Date(`${segments[0].departAt}Z`)) / 60000;
  const { base: b, perMin } = RATE[region];
  const price = (b + base * perMin) * (CABIN_MULT[cabin] || 1) * (0.85 + r() * 0.4) * (stops ? 0.88 : 1);
  return { durationMinutes, segments, price, region };
}

export async function searchFlights({ origin, destination, date, returnDate, adults, cabin = 'ECONOMY' }) {
  if (!byCode(origin) || !byCode(destination)) throw new AppError(400, 'UNKNOWN_PLACE', 'Choose an airport from the list.');
  const out = [];
  for (let i = 0; i < 9; i++) {
    const r = rng(`${origin}${destination}${date}${returnDate || ''}${cabin}${i}`);
    const legs = [leg(r, origin, destination, date, cabin)];
    if (returnDate) legs.push(leg(r, destination, origin, returnDate, cabin));
    const perAdult = Math.round(legs.reduce((s, l) => s + l.price, 0) / 10) * 10;
    const region = legs[0].region;
    const stops = Math.max(...legs.map((l) => l.segments.length - 1));
    const dto = {
      price: { total: perAdult * adults, perAdult, currency: config.currency },
      itineraries: legs.map(({ durationMinutes, segments }) => ({ durationMinutes, segments })),
      stops, cabin, checkedBags: region === 'int' ? '30 kg' : pick(r, ['20 kg', '23 kg', 'Cabin bag only']),
      refundable: r() < 0.4, seatsLeft: randInt(r, 2, 9), validatingCarrier: legs[0].segments[0].carrierName,
    };
    out.push({ dto, raw: { demo: true, dto: JSON.parse(JSON.stringify(dto)), adults } });
  }
  return out.sort((a, b) => a.dto.price.total - b.dto.price.total);
}

export async function priceFlight(raw) { return { raw, dto: raw.dto }; }

export async function flightSeatmaps(raw) {
  const segs = raw.dto.itineraries.flatMap((it) => it.segments);
  return segs.map((s, idx) => {
    const r = rng(`${s.number}${s.departAt}`);
    const small = /ATR|Embraer/.test(s.aircraft);   // small regional aircraft seat 2 + 2
    const columns = small ? ['A', 'B', '_', 'C', 'D'] : ['A', 'B', 'C', '_', 'D', 'E', 'F'];
    const rowsN = small ? 14 : 30;
    const rows = [];
    for (let row = 1; row <= rowsN; row++) {
      if (!small && row === 13) continue;
      const cells = {};
      for (const letter of columns.filter((c) => c !== '_')) {
        const extraLegroom = small ? row <= 2 : row <= 3 || row === 12 || row === 14;
        cells[letter] = {
          number: `${row}${letter}`, letter, available: r() > 0.38,
          price: small ? (extraLegroom ? 250 : row < 8 ? 80 : 0) : (row <= 3 ? 450 : extraLegroom ? 300 : row < 20 ? 120 : 0),
          extraLegroom, window: letter === 'A' || letter === columns.at(-1),
        };
      }
      rows.push({ row, cells });
    }
    return { segmentId: s.id || String(idx + 1), label: `${s.from} → ${s.to} · ${s.number}`, columns, rows };
  });
}

export async function bookFlight() { return { orderId: `DEMO-${randomId()}`, pnr: code(rng(randomId()), 6) }; }
export async function cancelFlight() {}
