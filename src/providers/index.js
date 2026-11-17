import { config } from '../config.js';

const live = config.provider === 'amadeus';
const [flights, hotels, locations] = await Promise.all(live
  ? [import('./amadeus/flights.js'), import('./amadeus/hotels.js'), import('./amadeus/locations.js')]
  : [import('./mock/flights.js'), import('./mock/hotels.js'), import('./mock/locations.js')]);

export const provider = { name: config.provider, flights, hotels, locations };
