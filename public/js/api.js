const KEY = 'pulse.session';

export const session = {
  get() { try { return JSON.parse(localStorage.getItem(KEY)); } catch { return null; } },
  set(v) { try { localStorage.setItem(KEY, JSON.stringify(v)); } catch { /* storage blocked */ } window.dispatchEvent(new Event('session')); },
  clear() { try { localStorage.removeItem(KEY); } catch { /* ignore */ } window.dispatchEvent(new Event('session')); },
};

export class ApiError extends Error {
  constructor(status, body) {
    super(body?.error?.message || 'Something went wrong. Please try again.');
    this.status = status;
    this.code = body?.error?.code;
    this.fields = body?.error?.fields;
    this.details = body?.error?.details;
  }
}

export async function api(path, { method = 'GET', body, query } = {}) {
  const url = new URL('/api' + path, location.origin);
  for (const [k, v] of Object.entries(query || {})) if (v !== undefined && v !== '' && v !== null) url.searchParams.set(k, v);
  const s = session.get();
  let res;
  try {
    res = await fetch(url, {
      method,
      headers: { ...(body ? { 'content-type': 'application/json' } : {}), ...(s ? { authorization: `Bearer ${s.token}` } : {}) },
      body: body ? JSON.stringify(body) : undefined,
    });
  } catch {
    throw new ApiError(0, { error: { message: 'Cannot reach the server. Check your connection.' } });
  }
  const json = await res.json().catch(() => ({}));
  if (!res.ok) {
    if (res.status === 401 && s && json?.error?.code === 'UNAUTHENTICATED') session.clear();
    throw new ApiError(res.status, json);
  }
  return json;
}
