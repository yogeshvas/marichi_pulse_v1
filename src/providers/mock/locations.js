import { PLACES } from '../../data/places.js';

export async function searchLocations(q, type) {
  const s = q.toLowerCase();
  return PLACES.filter((p) => p.code.toLowerCase().startsWith(s) || p.city.toLowerCase().includes(s) || p.name.toLowerCase().includes(s))
    .slice(0, 8)
    .map((p) => ({ code: p.code, type: type === 'city' ? 'city' : 'airport', name: type === 'city' ? p.city : p.name, city: p.city, country: p.country }));
}
