import { amadeus } from './client.js';

export async function searchLocations(q, type) {
  const subType = type === 'city' ? 'CITY' : 'CITY,AIRPORT';
  const res = await amadeus('GET', '/v1/reference-data/locations', { query: { subType, keyword: q, 'page[limit]': 8, view: 'LIGHT' } });
  return (res.data || []).map((l) => ({
    code: l.iataCode,
    type: l.subType === 'AIRPORT' ? 'airport' : 'city',
    name: l.name?.toLowerCase().replace(/\b\w/g, (c) => c.toUpperCase()),
    city: l.address?.cityName?.toLowerCase().replace(/\b\w/g, (c) => c.toUpperCase()) || '',
    country: l.address?.countryName || l.address?.countryCode || '',
  }));
}
