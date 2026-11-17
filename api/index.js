// Vercel serverless entry: every /api/* request is handled by the Express app.
// Vercel's disk is read-only except /tmp, so the demo SQLite database lives there and is
// rebuilt from the seed on every cold start. Use a hosted database before real customers.
import { createHash } from 'node:crypto';

process.env.DB_PATH ||= '/tmp/pulse.db';
const usingAmadeus = process.env.AMADEUS_CLIENT_ID && process.env.AMADEUS_CLIENT_SECRET && process.env.USE_MOCK !== 'true';
if (!process.env.JWT_SECRET && !usingAmadeus) {
  // Demo mode only. Set JWT_SECRET in Vercel to your own long random text.
  process.env.JWT_SECRET = createHash('sha256').update(`pulse-demo:${process.env.VERCEL_PROJECT_ID || 'local'}`).digest('hex');
}

const { app } = await import('../src/app.js');
const { ensureAdmin, seedDemo } = await import('../src/seed.js');

ensureAdmin();
if (!usingAmadeus && process.env.SEED_DEMO !== 'false') await seedDemo();

export default app;
