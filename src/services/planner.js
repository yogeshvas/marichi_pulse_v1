import { searchFlights, searchHotels } from './bookingService.js';
import { addDays } from './nlp.js';
import { round2 } from '../db.js';

const flightBrief = (f) => {
  const out = f.itineraries[0].segments, back = f.itineraries[1]?.segments;
  return {
    id: f.id, total: f.price.total, currency: f.price.currency, carrier: out[0].carrierName, number: out[0].number, stops: f.stops,
    departAt: out[0].departAt, arriveAt: out.at(-1).arriveAt, durationMinutes: f.itineraries[0].durationMinutes,
    returnDepartAt: back?.[0].departAt, refundable: f.refundable, checkedBags: f.checkedBags,
  };
};
const hotelBrief = (h, o) => ({ offerId: o.id, hotelId: h.id, name: h.name, stars: h.stars, score: h.score, area: h.address, room: o.room.type, board: o.board, total: o.price.total, perNight: o.price.perNight, refundable: o.cancellation.refundable, cancellation: o.cancellation.text });

/**
 * Builds three flight and hotel packages for the same trip: cheapest, best value and comfort.
 * Everything is a live offer, so each package links straight to checkout.
 */
export async function planTrip(user, { origin, destination, date, nights, adults, budget }) {
  const checkOut = addDays(date, nights);
  const [flights, hotels] = await Promise.all([
    searchFlights({ origin, destination, date, returnDate: checkOut, adults, cabin: 'ECONOMY', nonStop: false }, user),
    searchHotels({ cityCode: destination, checkIn: date, checkOut, adults, rooms: Math.max(1, Math.ceil(adults / 2)) }, user),
  ]);
  const offers = hotels.flatMap((h) => h.offers.map((o) => ({ h, o })));
  if (!flights.length || !offers.length) return { query: { origin, destination, date, checkOut, nights, adults, budget }, options: [], note: 'No flights or rooms were found for these dates.' };

  const quality = ({ h, o }) => ((h.score || 7.5) / 10) * 0.6 + ((h.stars || 3) / 5) * 0.4 + (o.cancellation.refundable ? 0.08 : 0);
  const cheapestFlight = [...flights].sort((a, b) => a.price.total - b.price.total)[0];
  const minF = cheapestFlight.price.total, minDur = Math.min(...flights.map((f) => f.itineraries[0].durationMinutes));
  const valueFlight = [...flights].sort((a, b) => (a.price.total / minF + a.itineraries[0].durationMinutes / minDur + a.stops * 0.4) - (b.price.total / minF + b.itineraries[0].durationMinutes / minDur + b.stops * 0.4))[0];
  const fastFlight = [...flights].filter((f) => f.stops === 0).sort((a, b) => a.itineraries[0].durationMinutes - b.itineraries[0].durationMinutes)[0] || valueFlight;

  const cheapestHotel = [...offers].sort((a, b) => a.o.price.total - b.o.price.total)[0];
  const minH = cheapestHotel.o.price.total;
  const valueHotel = [...offers].sort((a, b) => (b.o.price.total > 0 ? quality(b) / (b.o.price.total / minH) ** 0.7 : 0) - (a.o.price.total > 0 ? quality(a) / (a.o.price.total / minH) ** 0.7 : 0))[0];
  const comfortHotel = [...offers].filter((x) => x.o.cancellation.refundable).sort((a, b) => quality(b) - quality(a))[0] || valueHotel;

  const mk = (key, label, why, f, x) => {
    const total = round2(f.price.total + x.o.price.total);
    return { key, label, why, flight: flightBrief(f), hotel: hotelBrief(x.h, x.o), total, fitsBudget: budget ? total <= budget : null, overBy: budget && total > budget ? round2(total - budget) : 0 };
  };
  const options = [
    mk('budget', 'Lowest price', 'Cheapest flight and cheapest room.', cheapestFlight, cheapestHotel),
    mk('value', 'Best value', 'Balances price, flight time and hotel rating.', valueFlight, valueHotel),
    mk('comfort', 'Comfort', 'Fastest non-stop flight and a top rated room with free cancellation.', fastFlight, comfortHotel),
  ];
  const seen = new Set();
  const unique = options.filter((o) => { const k = `${o.flight.id}|${o.hotel.offerId}`; if (seen.has(k)) return false; seen.add(k); return true; });
  if (budget) unique.sort((a, b) => Number(b.fitsBudget) - Number(a.fitsBudget) || a.total - b.total);
  return { query: { origin, destination, date, checkOut, nights, adults, budget }, options: unique };
}
