import { Router } from 'express';
import { requireAuth, requireRole } from '../middleware/auth.js';
import { wrap } from '../middleware/error.js';
import * as svc from '../services/bookingService.js';
import { flightBooking, hotelBooking } from '../schemas.js';

export const bookings = Router();
bookings.use(requireAuth);

const canBook = (req, _res, next) => (req.user.role === 'agent' ? requireRole('agent')(req, _res, next) : next());
bookings.post('/flights', canBook, wrap(async (req, res) => res.status(201).json(await svc.bookFlight(req.user, flightBooking.parse(req.body)))));
bookings.post('/hotels', canBook, wrap(async (req, res) => res.status(201).json(await svc.bookHotel(req.user, hotelBooking.parse(req.body)))));
bookings.get('/', (req, res) => res.json({ bookings: svc.listBookings(req.user) }));
bookings.get('/manage', requireRole('agent', 'admin'), (req, res) => res.json(svc.manageBookings(req.user, req.query)));
bookings.get('/:ref', (req, res) => res.json(svc.getBooking(req.user, req.params.ref)));
bookings.post('/:ref/cancel', wrap(async (req, res) => res.json(await svc.cancelBooking(req.user, req.params.ref))));
