import { app } from './app.js';
import { config } from './config.js';
import { ensureAdmin, seedDemo } from './seed.js';

ensureAdmin();
if (config.provider === 'mock' && process.env.SEED_DEMO !== 'false') await seedDemo();

const server = app.listen(config.port, () => {
  const mode = config.provider === 'amadeus' ? `Amadeus (${config.amadeus.baseUrl})` : 'demo data (no Amadeus keys set)';
  console.log(`Marichi Pulse running at http://localhost:${config.port}\nData source: ${mode}`);
});
for (const sig of ['SIGINT', 'SIGTERM']) process.on(sig, () => server.close(() => process.exit(0)));
