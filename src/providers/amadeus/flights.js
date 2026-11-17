import { amadeus, isoToMinutes } from './client.js';
import { config } from '../../config.js';
import { AppError } from '../../errors.js';

export const capabilities = { seatPurchase: false };

function normalizeOffer(o, dict) {
  const itineraries = o.itineraries.map((it) => ({
    durationMinutes: isoToMinutes(it.duration),
    segments: it.segments.map((s) => ({
      id: s.id,
      from: s.departure.iataCode,
      to: s.arrival.iataCode,
      departAt: s.departure.at,
      arriveAt: s.arrival.at,
      terminalFrom: s.departure.terminal || null,
      carrier: s.carrierCode,
      carrierName: dict?.carriers?.[s.carrierCode] || s.carrierCode,
      number: `${s.carrierCode} ${s.number}`,
      aircraft: dict?.aircraft?.[s.aircraft?.code] || s.aircraft?.code || '',
      durationMinutes: isoToMinutes(s.duration),
    })),
  }));
  const fare = o.travelerPricings?.[0]?.fareDetailsBySegment?.[0];
  const adults = o.travelerPricings?.length || 1;
  const total = Number(o.price.grandTotal || o.price.total);
  const bags = fare?.includedCheckedBags;
  return {
    price: { total, perAdult: Math.round((total / adults) * 100) / 100, currency: o.price.currency },
    itineraries,
    stops: Math.max(...itineraries.map((i) => i.segments.length - 1)),
    cabin: fare?.cabin || 'ECONOMY',
    checkedBags: bags?.weight ? `${bags.weight} ${bags.weightUnit || 'KG'}` : bags?.quantity ? `${bags.quantity} bag` : 'Cabin bag only',
    refundable: null,
    seatsLeft: o.numberOfBookableSeats ?? null,
    validatingCarrier: dict?.carriers?.[o.validatingAirlineCodes?.[0]] || o.validatingAirlineCodes?.[0] || null,
  };
}

export async function searchFlights({ origin, destination, date, returnDate, adults, cabin, nonStop, currency }) {
  const res = await amadeus('GET', '/v2/shopping/flight-offers', {
    query: {
      originLocationCode: origin,
      destinationLocationCode: destination,
      departureDate: date,
      returnDate,
      adults,
      travelClass: cabin,
      nonStop: nonStop ? 'true' : undefined,
      currencyCode: currency || config.currency,
      max: 40,
    },
  });
  return (res.data || []).map((raw) => ({ raw, dto: normalizeOffer(raw, res.dictionaries) }));
}

export async function priceFlight(raw) {
  const res = await amadeus('POST', '/v1/shopping/flight-offers/pricing', {
    body: { data: { type: 'flight-offers-pricing', flightOffers: [raw] } },
  });
  const priced = res.data?.flightOffers?.[0];
  if (!priced) throw new AppError(410, 'OFFER_GONE', 'This fare is no longer available.');
  return { raw: priced, dto: normalizeOffer(priced, res.dictionaries) };
}

export async function flightSeatmaps(raw) {
  const res = await amadeus('POST', '/v1/shopping/seatmaps', { body: { data: [raw] } });
  return (res.data || []).map((m) => {
    const seats = m.decks?.[0]?.seats || [];
    // Column order and aisles come from the seat coordinates.
    const colY = new Map();
    for (const s of seats) {
      const letter = s.number.replace(/\d+/g, '');
      if (s.coordinates && !colY.has(letter)) colY.set(letter, s.coordinates.y);
    }
    const letters = [...colY.entries()].sort((a, b) => a[1] - b[1]);
    const columns = [];
    letters.forEach(([letter, y], i) => {
      if (i > 0 && y - letters[i - 1][1] > 1) columns.push('_');
      columns.push(letter);
    });
    const rows = new Map();
    for (const s of seats) {
      const row = parseInt(s.number, 10);
      const letter = s.number.replace(/\d+/g, '');
      const tp = s.travelerPricing?.[0];
      const codes = s.characteristicsCodes || [];
      const cell = {
        number: s.number,
        letter,
        available: tp?.seatAvailabilityStatus === 'AVAILABLE',
        price: tp?.price?.total ? Number(tp.price.total) : 0,
        extraLegroom: codes.includes('L') || codes.includes('E'),
        window: codes.includes('W'),
      };
      if (!rows.has(row)) rows.set(row, {});
      rows.get(row)[letter] = cell;
    }
    return {
      segmentId: m.segmentId,
      label: `${m.departure?.iataCode} → ${m.arrival?.iataCode} · ${m.carrierCode} ${m.number}`,
      columns,
      rows: [...rows.entries()].sort((a, b) => a[0] - b[0]).map(([row, cells]) => ({ row, cells })),
    };
  });
}

const GENDER = { M: 'MALE', F: 'FEMALE' };

export async function bookFlight({ raw, travelers, contact }) {
  const body = {
    data: {
      type: 'flight-order',
      flightOffers: [raw],
      travelers: travelers.map((t, i) => ({
        id: String(i + 1),
        dateOfBirth: t.dob,
        name: { firstName: t.firstName.toUpperCase(), lastName: t.lastName.toUpperCase() },
        gender: GENDER[t.gender] || 'MALE',
        contact: {
          emailAddress: contact.email,
          phones: [{ deviceType: 'MOBILE', countryCallingCode: contact.countryCode.replace('+', ''), number: contact.phone }],
        },
        ...(t.passport ? {
          documents: [{
            documentType: 'PASSPORT',
            number: t.passport.number,
            expiryDate: t.passport.expiry,
            issuanceCountry: t.passport.country,
            nationality: t.passport.country,
            holder: true,
          }],
        } : {}),
      })),
      remarks: { general: [{ subType: 'GENERAL_MISCELLANEOUS', text: 'ONLINE BOOKING' }] },
      ticketingAgreement: { option: 'DELAY_TO_CANCEL', delay: '6D' },
      contacts: [{
        addresseeName: { firstName: travelers[0].firstName.toUpperCase(), lastName: travelers[0].lastName.toUpperCase() },
        purpose: 'STANDARD',
        phones: [{ deviceType: 'MOBILE', countryCallingCode: contact.countryCode.replace('+', ''), number: contact.phone }],
        emailAddress: contact.email,
        address: { lines: ['N/A'], postalCode: '000000', cityName: 'N/A', countryCode: 'IN' },
      }],
    },
  };
  const res = await amadeus('POST', '/v1/booking/flight-orders', { body });
  return {
    orderId: res.data.id,
    pnr: res.data.associatedRecords?.[0]?.reference || res.data.id,
  };
}

export async function cancelFlight(orderId) {
  await amadeus('DELETE', `/v1/booking/flight-orders/${encodeURIComponent(orderId)}`);
}

/** Cheapest fare per day. Cached data from Amadeus, so some days can be missing. */
export async function flightDates({ origin, destination, from, to }) {
  try {
    const res = await amadeus('GET', '/v1/shopping/flight-dates', { query: { origin, destination, departureDate: `${from},${to}`, oneWay: 'true', viewBy: 'DATE' } });
    return (res.data || []).map((d) => ({ date: d.departureDate, price: Number(d.price.total) }));
  } catch { return []; }
}
