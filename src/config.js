const env = process.env;
const clientId = env.AMADEUS_CLIENT_ID || '';
const clientSecret = env.AMADEUS_CLIENT_SECRET || '';
const prod = env.NODE_ENV === 'production';

if (prod && !env.JWT_SECRET) throw new Error('JWT_SECRET must be set in production');

export const config = {
  env: env.NODE_ENV || 'development',
  port: Number(env.PORT) || 3000,
  jwtSecret: env.JWT_SECRET || 'dev-only-secret-change-me',
  dbPath: env.DB_PATH || './data/skyline.db',
  currency: env.CURRENCY || 'ZMW',
  corsOrigin: env.CORS_ORIGIN || '',
  agentEmail: env.AGENT_EMAIL || 'bookings@example.com',
  provider: clientId && clientSecret && env.USE_MOCK !== 'true' ? 'amadeus' : 'mock',
  amadeus: {
    clientId,
    clientSecret,
    baseUrl: env.AMADEUS_BASE_URL || 'https://test.api.amadeus.com',
    hotelOrderPath: env.AMADEUS_HOTEL_ORDER_PATH || '/v2/booking/hotel-orders',
  },
  // Card the platform uses to pay the hotel provider (merchant model). Needed with live Amadeus hotels.
  agencyCard: env.AGENCY_CARD_NUMBER ? {
    number: env.AGENCY_CARD_NUMBER, expMonth: Number(env.AGENCY_CARD_EXP_MONTH), expYear: Number(env.AGENCY_CARD_EXP_YEAR),
    holder: env.AGENCY_CARD_HOLDER || 'SKYLINE TRAVEL', cvv: '000',
  } : null,
  flightCancelFeePct: 10,
  offerTtlMs: 30 * 60 * 1000,
};
