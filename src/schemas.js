import { z } from 'zod';

const today = () => new Date().toISOString().slice(0, 10);
export const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Use a valid date').refine((d) => !Number.isNaN(Date.parse(d)), 'Use a valid date');
export const futureDate = isoDate.refine((d) => d >= today(), 'Date cannot be in the past');
const iata = z.string().length(3).transform((s) => s.toUpperCase());
const name = z.string().trim().min(1, 'Required').max(40).regex(/^[\p{L}][\p{L} '.-]*$/u, 'Letters only');

export const flightSearch = z.object({
  origin: iata, destination: iata, date: futureDate, returnDate: futureDate.optional(),
  adults: z.coerce.number().int().min(1).max(9).default(1),
  cabin: z.enum(['ECONOMY', 'PREMIUM_ECONOMY', 'BUSINESS', 'FIRST']).default('ECONOMY'),
  nonStop: z.enum(['true', 'false']).optional().transform((v) => v === 'true'),
}).refine((v) => v.origin !== v.destination, { message: 'Origin and destination must differ', path: ['destination'] })
  .refine((v) => !v.returnDate || v.returnDate >= v.date, { message: 'Return must be on or after departure', path: ['returnDate'] });

export const hotelSearch = z.object({
  cityCode: iata, checkIn: futureDate, checkOut: isoDate,
  adults: z.coerce.number().int().min(1).max(9).default(2),
  rooms: z.coerce.number().int().min(1).max(5).default(1),
}).refine((v) => v.checkOut > v.checkIn, { message: 'Check out must be after check in', path: ['checkOut'] })
  .refine((v) => (new Date(v.checkOut) - new Date(v.checkIn)) / 864e5 <= 30, { message: 'Stays are limited to 30 nights', path: ['checkOut'] });

export const card = z.object({
  number: z.string().regex(/^[\d ]{13,23}$/, 'Enter the card number'),
  expMonth: z.coerce.number().int().min(1).max(12),
  expYear: z.coerce.number().int().min(2024).max(2060),
  cvv: z.string().regex(/^\d{3,4}$/, 'Enter the 3 or 4 digit code'),
  holder: z.string().trim().min(2, 'Enter the name on the card').max(60),
});

const phone = z.string().regex(/^\d{6,14}$/, 'Digits only, without country code');
export const contact = z.object({
  email: z.string().email('Enter a valid email'),
  countryCode: z.string().regex(/^\+\d{1,3}$/, 'Like +91'),
  phone,
});

const traveler = z.object({
  firstName: name, lastName: name, dob: isoDate.refine((d) => d < today(), 'Birth date must be in the past'),
  gender: z.enum(['M', 'F']),
  passport: z.object({
    number: z.string().regex(/^[A-Za-z0-9]{6,12}$/, 'Passport number looks wrong'),
    expiry: futureDate, country: iata.or(z.string().length(2).transform((s) => s.toUpperCase())),
  }).optional(),
});

export const agentOpts = z.object({
  customerId: z.number().int().positive().optional(),
  newCustomer: z.object({ name: z.string().trim().min(2).max(80), email: z.string().email().optional().or(z.literal('')), phone: z.string().max(20).optional() }).optional(),
  serviceFee: z.number().min(0).max(100000).default(0),
  paymentMode: z.enum(['wallet', 'card']).default('wallet'),
}).optional();

const NETWORKS = { mtn: 'MTN', airtel: 'Airtel', zamtel: 'Zamtel' };
const NET_PREFIX = { mtn: ['96', '76'], airtel: ['97', '77'], zamtel: ['95', '75'] };
/** Zambian mobile number as 9 national digits, from 097..., 97..., 260... or +260... */
export const msisdn = (p) => { const d = String(p).replace(/\D/g, ''); return d.startsWith('260') ? d.slice(3) : d.startsWith('0') ? d.slice(1) : d; };
export const momo = z.object({ network: z.enum(['mtn', 'airtel', 'zamtel']), phone: z.string().max(20) }).superRefine((v, ctx) => {
  const n = msisdn(v.phone);
  if (!/^\d{9}$/.test(n)) ctx.addIssue({ path: ['phone'], code: 'custom', message: 'Enter a Zambian mobile number, like 097 123 4567' });
  else if (!NET_PREFIX[v.network].includes(n.slice(0, 2))) ctx.addIssue({ path: ['phone'], code: 'custom', message: `This number is not on ${NETWORKS[v.network]}. Check the network.` });
}).transform((v) => ({ network: v.network, phone: msisdn(v.phone) }));

export const flightBooking = z.object({
  offerId: z.string().min(3), travelers: z.array(traveler).min(1).max(9), contact,
  seats: z.array(z.object({ segmentId: z.string(), travelerIndex: z.number().int().min(0).max(8), number: z.string().regex(/^\d{1,2}[A-K]$/) })).max(40).default([]),
  card: card.optional(), momo: momo.optional(), acceptPrice: z.boolean().optional(), agent: agentOpts, promoCode: z.string().max(30).optional(), usePoints: z.boolean().optional(),
});

export const hotelBooking = z.object({
  offerId: z.string().min(3),
  guest: z.object({ title: z.enum(['MR', 'MRS', 'MS']).default('MR'), firstName: name, lastName: name, email: z.string().email('Enter a valid email'), phone: z.string().regex(/^\+\d{8,15}$/, 'Include country code, like +260971234567') }),
  card: card.optional(), momo: momo.optional(), acceptPrice: z.boolean().optional(), agent: agentOpts, promoCode: z.string().max(30).optional(), usePoints: z.boolean().optional(),
});

export const register = z.object({ name: z.string().trim().min(2).max(60), email: z.string().email().toLowerCase(), password: z.string().min(8, 'At least 8 characters').max(100) });
export const login = z.object({ email: z.string().email().toLowerCase(), password: z.string().min(1) });
