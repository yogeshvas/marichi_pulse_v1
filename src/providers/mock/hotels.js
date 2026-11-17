import { rng, pick, randInt, randomId, code } from './util.js';
import { byCode } from '../../data/places.js';
import { AppError } from '../../errors.js';
import { config } from '../../config.js';

export const capabilities = { cancelViaApi: true, cardPassthrough: false };

const PREFIX = ['Mosi-oa-Tunya', 'Zambezi', 'Kafue', 'Luangwa', 'Copper', 'Baobab', 'Kalambo', 'Munda', 'Mukuni', 'Chobe View', 'Acacia', 'Sunset'];
const SUFFIX = ['Lodge', 'Hotel', 'Suites', 'Inn', 'Safari Camp', 'Retreat', 'Guest House', 'Resort'];
const AREAS = ['Cairo Road', 'Kabulonga', 'Roma', 'Woodlands', 'Longacres', 'Mosi-oa-Tunya Road', 'Zambezi Riverfront', 'Kafue Road', 'Northmead', 'Town Centre'];
const AMEN = ['Wi-Fi', 'Pool', 'Restaurant', 'Airport shuttle', 'Backup power', 'Free parking', 'Safari tours', 'Conference room', 'Bar', 'Air conditioning'];
const ROOMS = [['Standard Room', '1 queen bed', 1], ['Deluxe Room', '1 king bed', 1.3], ['Family Room', '2 queen beds', 1.6], ['Executive Suite', '1 king bed + lounge', 2.2]];
const PREMIUM_CITIES = { LVI: 1.4, MFU: 1.6, VFA: 1.5 };   // tourist areas cost more
const VAT = 0.16;

const nightsBetween = (a, b) => Math.max(1, Math.round((new Date(b) - new Date(a)) / 864e5));

export async function searchHotels({ cityCode, checkIn, checkOut, adults, rooms }) {
  if (!byCode(cityCode)) throw new AppError(400, 'UNKNOWN_PLACE', 'Choose a city from the list.');
  const nights = nightsBetween(checkIn, checkOut);
  const hotels = [];
  for (let i = 0; i < 11; i++) {
    const r = rng(`${cityCode}${i}`);
    const stars = pick(r, [3, 3, 4, 4, 4, 5]);
    const basePrice = ({ 3: 900, 4: 1800, 5: 3800 }[stars] + randInt(r, 0, 400)) * (PREMIUM_CITIES[cityCode] || 1);
    const weekend = [5, 6].includes(new Date(checkIn).getDay()) ? 1.15 : 1;
    const hotel = {
      id: `${cityCode}${100 + i}`, name: `${pick(r, PREFIX)} ${pick(r, SUFFIX)}`, stars, cityCode,
      address: `${randInt(r, 1, 120)} ${pick(r, AREAS)}`, distanceKm: Math.round(r() * 120) / 10, geo: null,
      amenities: [...new Set(Array.from({ length: randInt(r, 3, 6) }, () => pick(r, AMEN)))],
      score: Math.round((7 + r() * 2.8) * 10) / 10, reviews: randInt(r, 40, 1800), offers: [],
    };
    if (rng(`${hotel.id}${checkIn}`)() < 0.12) continue;
    ROOMS.slice(0, randInt(r, 2, 4)).forEach(([type, bed, mult], k) => {
      for (const flex of [false, true]) {
        const perNight = Math.round((basePrice * mult * weekend * (flex ? 1.12 : 1)) / 10) * 10 * rooms;
        const sub = perNight * nights;
        const taxes = Math.round(sub * VAT);
        const deadline = flex ? `${new Date(new Date(checkIn).getTime() - 2 * 864e5).toISOString().slice(0, 10)}T18:00:00` : null;
        hotel.offers.push({
          id: `${hotel.id}-${k}${flex ? 'F' : 'N'}-${checkIn.replaceAll('-', '')}${checkOut.replaceAll('-', '')}${adults}${rooms}`,
          room: { type, bed, description: `${type} with ${bed}, air conditioning, work desk and en-suite bathroom.` },
          board: flex || k % 2 ? 'Breakfast included' : 'Room only',
          price: { total: sub + taxes, taxes, perNight: Math.round(perNight), currency: config.currency },
          cancellation: { refundable: flex, deadline, text: flex ? `Free cancellation until ${deadline.slice(0, 10)}` : 'Non-refundable' },
          paymentType: 'guarantee', checkIn, checkOut,
        });
      }
    });
    hotels.push(hotel);
  }
  return hotels;
}

export async function refreshHotelOffer(_offerId, ctx) { return ctx.cached; }
export async function bookHotel() { return { orderId: `DEMO-${randomId()}`, confirmation: code(rng(randomId()), 8) }; }
export async function cancelHotel() { return { requested: false }; }
