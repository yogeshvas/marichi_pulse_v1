import { config } from '../../config.js';
import { AppError } from '../../errors.js';

const { baseUrl, clientId, clientSecret } = config.amadeus;
let token = null;
let tokenExpiresAt = 0;
let inflight = null;

async function fetchToken() {
  const res = await fetch(`${baseUrl}/v1/security/oauth2/token`, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ grant_type: 'client_credentials', client_id: clientId, client_secret: clientSecret }),
    signal: AbortSignal.timeout(15000),
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new AppError(502, 'PROVIDER_AUTH', 'Could not authenticate with Amadeus. Check the API key and secret.');
  token = body.access_token;
  tokenExpiresAt = Date.now() + (body.expires_in || 1700) * 1000;
  return token;
}

async function getToken(force = false) {
  if (!force && token && Date.now() < tokenExpiresAt - 30000) return token;
  inflight ??= fetchToken().finally(() => { inflight = null; });
  return inflight;
}

function toAppError(status, body) {
  const first = body?.errors?.[0];
  const detail = first?.detail || first?.title || 'Amadeus returned an error';
  if (status === 429) return new AppError(503, 'PROVIDER_BUSY', 'The airline system is busy. Try again in a moment.');
  if (status >= 500) return new AppError(502, 'PROVIDER_ERROR', 'The airline system is not responding. Try again shortly.');
  if (status === 404 || status === 410) return new AppError(410, 'OFFER_GONE', detail);
  return new AppError(status === 401 ? 502 : 400, 'PROVIDER_REJECTED', detail, body?.errors);
}

/** Calls Amadeus with a cached bearer token and one automatic retry on 401. */
export async function amadeus(method, path, { query, body } = {}) {
  const url = new URL(path, baseUrl);
  for (const [k, v] of Object.entries(query || {})) if (v !== undefined && v !== null && v !== '') url.searchParams.set(k, v);

  for (let attempt = 0; attempt < 2; attempt++) {
    const res = await fetch(url, {
      method,
      headers: {
        authorization: `Bearer ${await getToken(attempt > 0)}`,
        accept: 'application/vnd.amadeus+json',
        ...(body ? { 'content-type': 'application/vnd.amadeus+json' } : {}),
      },
      body: body ? JSON.stringify(body) : undefined,
      signal: AbortSignal.timeout(25000),
    }).catch((e) => { throw new AppError(504, 'PROVIDER_TIMEOUT', 'The airline system took too long to answer.', e.message); });

    if (res.status === 401 && attempt === 0) continue;
    const text = await res.text();
    const json = text ? JSON.parse(text) : {};
    if (!res.ok) throw toAppError(res.status, json);
    return json;
  }
}

export const isoToMinutes = (iso = '') => {
  const m = /P(?:(\d+)D)?T?(?:(\d+)H)?(?:(\d+)M)?/.exec(iso) || [];
  return (Number(m[1]) || 0) * 1440 + (Number(m[2]) || 0) * 60 + (Number(m[3]) || 0);
};
