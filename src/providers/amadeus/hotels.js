import { amadeus } from './client.js';
import { config } from '../../config.js';
import { AppError } from '../../errors.js';

export const capabilities = { cancelViaApi: false, cardPassthrough: true };

const nightsBetween = (a, b) => Math.max(1, Math.round((new Date(b) - new Date(a)) / 864e5));

function normalizeOffer(o, nights) {
  const total = Number(o.price?.total);
  const taxes = (o.price?.taxes || []).reduce((s, t) => s + Number(t.amount || 0), 0);
  const cancel = o.policies?.cancellations?.[0];
  const rr = o.policies?.refundable?.cancellationRefund || '';
  const refundable = Boolean(cancel?.deadline) || (/REFUNDABLE/.test(rr) && !/NON/.test(rr));
  const est = o.room?.typeEstimated || {};
  return {
    id: o.id,
    room: {
      type: (est.category || o.room?.type || 'Room').replace(/_/g, ' ').toLowerCase().replace(/^\w/, (c) => c.toUpperCase()),
      bed: [est.beds, est.bedType].filter(Boolean).join(' × ').toLowerCase() || 'Bed type on request',
      description: o.room?.description?.text || '',
    },
    board: (o.boardType || 'ROOM_ONLY').replace(/_/g, ' ').toLowerCase().replace(/^\w/, (c) => c.toUpperCase()),
    price: { total, taxes, perNight: Math.round(total / nights), currency: o.price?.currency },
    cancellation: {
      refundable,
      deadline: cancel?.deadline || null,
      text: refundable
        ? cancel?.deadline ? `Free cancellation until ${cancel.deadline.slice(0, 10)}` : 'Free cancellation'
        : 'Non-refundable',
    },
    paymentType: o.policies?.paymentType || 'guarantee',
    checkIn: o.checkInDate,
    checkOut: o.checkOutDate,
  };
}

function normalizeHotel(entry, listing, nights) {
  const h = entry.hotel || {};
  const base = listing.get(h.hotelId) || {};
  return {
    id: h.hotelId,
    name: (h.name || base.name || 'Hotel').toLowerCase().replace(/\b\w/g, (c) => c.toUpperCase()),
    stars: Number(h.rating) || null,
    cityCode: h.cityCode || base.iataCode,
    address: base.address?.lines?.join(', ') || '',
    distanceKm: base.distance?.value ?? null,
    geo: h.latitude ? { lat: h.latitude, lng: h.longitude } : base.geoCode ? { lat: base.geoCode.latitude, lng: base.geoCode.longitude } : null,
    amenities: [],
    score: null,
    offers: (entry.offers || []).map((o) => normalizeOffer(o, nights)),
  };
}

export async function searchHotels({ cityCode, checkIn, checkOut, adults, rooms, currency }) {
  const list = await amadeus('GET', '/v1/reference-data/locations/hotels/by-city', { query: { cityCode, radius: 20, radiusUnit: 'KM' } });
  const listing = new Map((list.data || []).map((h) => [h.hotelId, h]));
  const ids = [...listing.keys()].slice(0, 60);
  if (!ids.length) return [];
  const nights = nightsBetween(checkIn, checkOut);

  const chunks = [];
  for (let i = 0; i < ids.length; i += 20) chunks.push(ids.slice(i, i + 20));
  const settled = await Promise.allSettled(chunks.map((c) => amadeus('GET', '/v3/shopping/hotel-offers', {
    query: { hotelIds: c.join(','), checkInDate: checkIn, checkOutDate: checkOut, adults, roomQuantity: rooms, currency: currency || config.currency, bestRateOnly: 'false' },
  })));
  const entries = settled.filter((s) => s.status === 'fulfilled').flatMap((s) => s.value.data || []);
  if (!entries.length && settled.every((s) => s.status === 'rejected')) throw settled[0].reason;

  const hotels = entries.filter((e) => e.available !== false && e.offers?.length).map((e) => normalizeHotel(e, listing, nights));

  // Guest scores are optional. A failure here must not break the search.
  try {
    const sent = await amadeus('GET', '/v2/e-reputation/hotel-sentiments', { query: { hotelIds: hotels.slice(0, 3).map((h) => h.id).join(',') } });
    for (const s of sent.data || []) {
      const h = hotels.find((x) => x.id === s.hotelId);
      if (h) { h.score = Math.round(s.overallRating) / 10; h.reviews = s.numberOfReviews; }
    }
  } catch { /* ignore */ }
  return hotels;
}

export async function refreshHotelOffer(offerId, { checkIn, checkOut }) {
  const res = await amadeus('GET', `/v3/shopping/hotel-offers/${encodeURIComponent(offerId)}`);
  const entry = res.data;
  const offer = entry?.offers?.find((o) => o.id === offerId) || entry?.offers?.[0];
  if (!offer) throw new AppError(410, 'OFFER_GONE', 'This room is no longer available.');
  return normalizeOffer(offer, nightsBetween(checkIn, checkOut));
}

const VENDOR = { 4: 'VI', 5: 'CA', 3: 'AX', 6: 'DS' };

export async function bookHotel({ offerId, guests, card }) {
  const digits = card.number.replace(/\s/g, '');
  const body = {
    data: {
      type: 'hotel-order',
      guests: guests.map((g, i) => ({
        tid: i + 1, title: g.title || 'MR', firstName: g.firstName, lastName: g.lastName, phone: g.phone, email: g.email,
      })),
      travelAgent: { contact: { email: config.agentEmail } },
      roomAssociations: [{ guestReferences: guests.map((_, i) => ({ guestReference: String(i + 1) })), hotelOfferId: offerId }],
      payment: {
        method: 'CREDIT_CARD',
        paymentCard: {
          paymentCardInfo: {
            vendorCode: VENDOR[digits[0]] || 'VI',
            cardNumber: digits,
            expiryDate: `${card.expYear}-${String(card.expMonth).padStart(2, '0')}`,
            holderName: card.holder,
          },
        },
      },
    },
  };
  const res = await amadeus('POST', config.amadeus.hotelOrderPath, { body });
  const booking = res.data?.hotelBookings?.[0];
  return {
    orderId: res.data?.id,
    confirmation: booking?.hotelProviderInformation?.[0]?.confirmationNumber || booking?.id || res.data?.id,
  };
}

export async function cancelHotel() {
  // The Self-Service hotel API has no cancel call. The request is recorded and handled by the support team.
  return { requested: true };
}
