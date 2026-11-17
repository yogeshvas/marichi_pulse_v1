import express from 'express';
import helmet from 'helmet';
import cors from 'cors';
import rateLimit from 'express-rate-limit';
import { fileURLToPath } from 'node:url';
import { config } from './config.js';
import { auth } from './routes/auth.js';
import { catalog } from './routes/catalog.js';
import { bookings } from './routes/bookings.js';
import { reports } from './routes/reports.js';
import { agent } from './routes/agent.js';
import { admin } from './routes/admin.js';
import { support } from './routes/support.js';
import { account } from './routes/account.js';
import { ai } from './routes/ai.js';
import { errorHandler, notFound } from './middleware/error.js';

export const app = express();
app.disable('x-powered-by');
app.set('trust proxy', 1);

// Safari does not exempt localhost from "upgrade-insecure-requests", so these are only enabled in production behind HTTPS.
const https = config.env === 'production';
app.use(helmet({
  hsts: https,
  contentSecurityPolicy: {
    directives: {
      upgradeInsecureRequests: https ? [] : null,
      defaultSrc: ["'self'"],
      scriptSrc: ["'self'"],
      styleSrc: ["'self'", "'unsafe-inline'", 'https://fonts.googleapis.com'],
      fontSrc: ["'self'", 'https://fonts.gstatic.com'],
      imgSrc: ["'self'", 'data:'],
      connectSrc: ["'self'"],
      frameAncestors: ["'none'"],
    },
  },
}));
if (config.corsOrigin) app.use(cors({ origin: config.corsOrigin.split(',') }));
app.use(express.json({ limit: '100kb' }));

app.get('/healthz', (_req, res) => res.json({ ok: true, provider: config.provider }));

const api = express.Router();
api.use(rateLimit({ windowMs: 15 * 60 * 1000, limit: 600, standardHeaders: true, legacyHeaders: false }));
api.use('/auth', rateLimit({ windowMs: 15 * 60 * 1000, limit: 40, standardHeaders: true, legacyHeaders: false }), auth);
api.use('/bookings', bookings);
api.use('/reports', reports);
api.use('/agent', agent);
api.use('/admin', admin);
api.use('/support', support);
api.use('/account', account);
api.use('/ai', ai);
api.use('/', catalog);
api.use(notFound);
app.use('/api', api);

app.use(express.static(fileURLToPath(new URL('../public', import.meta.url)), { extensions: ['html'] }));
app.use(errorHandler);
