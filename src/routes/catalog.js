import { Router } from 'express';
import { provider } from '../providers/index.js';
import { wrap } from '../middleware/error.js';
import * as svc from '../services/bookingService.js';
import { flightSearch, hotelSearch } from '../schemas.js';
import { z } from 'zod';
import { publicOffers } from '../services/rewards.js';
import { optionalAuth } from '../middleware/auth.js';
import { getSettings } from '../services/settings.js';
import { config } from '../config.js';

export const catalog = Router();

catalog.get('/config', (_req, res) => res.json({
  flightCancelFeePct: getSettings().flightCancelFeePct,
  mode: provider.name === 'amadeus' ? 'live' : 'demo',
  currency: config.currency,
  flights: provider.flights.capabilities,
  hotels: provider.hotels.capabilities,
}));

catalog.get('/locations', wrap(async (req, res) => {
  const q = String(req.query.q || '').trim();
  if (q.length < 2) return res.json({ items: [] });
  const type = req.query.type === 'city' ? 'city' : 'any';
  res.json({ items: await provider.locations.searchLocations(q.slice(0, 40), type) });
}));

catalog.get('/flights/search', optionalAuth, wrap(async (req, res) => {
  const q = flightSearch.parse(req.query);
  res.json({ query: q, offers: await svc.searchFlights(q, req.user) });
}));
catalog.post('/flights/offers/:id/price', wrap(async (req, res) => res.json(await svc.priceFlight(req.params.id))));
catalog.get('/flights/offers/:id/seatmap', wrap(async (req, res) => res.json(await svc.flightSeatmaps(req.params.id))));

catalog.get('/hotels/search', optionalAuth, wrap(async (req, res) => {
  const q = hotelSearch.parse(req.query);
  res.json({ query: q, hotels: await svc.searchHotels(q, req.user) });
}));
catalog.get('/hotels/offers/:id', wrap(async (req, res) => res.json(await svc.refreshHotelOffer(req.params.id))));

catalog.get('/offers', (_req, res) => res.json({ offers: publicOffers() }));

catalog.get('/flights/calendar', optionalAuth, wrap(async (req, res) => {
  const q = flightSearch.parse({ ...req.query, returnDate: undefined });
  res.json({ days: await svc.flightCalendar(q, req.user) });
}));

catalog.post('/checkout/quote', optionalAuth, wrap(async (req, res) => {
  const b = z.object({ kind: z.enum(['flight', 'hotel']), offerId: z.string(), extra: z.number().min(0).max(500000).optional(), promoCode: z.string().max(30).optional(), usePoints: z.boolean().optional() }).parse(req.body);
  res.json(svc.quoteCheckout(req.user, b));
}));
