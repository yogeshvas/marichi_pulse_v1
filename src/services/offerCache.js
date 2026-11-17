import { config } from '../config.js';
import { AppError } from '../errors.js';

// In-memory store for provider offers between search and booking.
// Swap for Redis if you run more than one server instance.
const store = new Map();

export function put(key, value) {
  store.set(key, { value, expires: Date.now() + config.offerTtlMs });
  return key;
}
export function get(key) {
  const e = store.get(key);
  if (!e || e.expires < Date.now()) {
    store.delete(key);
    throw new AppError(410, 'OFFER_EXPIRED', 'This offer has expired. Please search again.');
  }
  return e.value;
}
export function update(key, patch) {
  const e = store.get(key);
  if (e) Object.assign(e.value, patch);
}

setInterval(() => {
  const now = Date.now();
  for (const [k, e] of store) if (e.expires < now) store.delete(k);
}, 5 * 60 * 1000).unref();
