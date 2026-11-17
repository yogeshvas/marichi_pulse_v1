import { db } from '../db.js';
import { config } from '../config.js';

export const DEFAULTS = {
  markupFlightPct: 4,        // added to flight fares sold to direct customers
  markupHotelPct: 6,         // added to hotel rates sold to direct customers
  agentMarkupFlightPct: 3,   // added to flight fares sold to agents (net rate)
  agentMarkupHotelPct: 4,    // added to hotel rates sold to agents (net rate)
  defaultCommissionPct: 1.5, // starting commission for new agents
  flightCancelFeePct: config.flightCancelFeePct,
  supportEmail: 'support@marichipulse.example',
};
let cache = null;

export function getSettings() {
  if (!cache) {
    const rows = db.prepare('SELECT key, value FROM settings').all();
    cache = { ...DEFAULTS };
    for (const r of rows) if (r.key in DEFAULTS) cache[r.key] = JSON.parse(r.value);
  }
  return { ...cache };
}

export function saveSettings(patch) {
  const up = db.prepare('INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value');
  for (const [k, v] of Object.entries(patch)) if (k in DEFAULTS) up.run(k, JSON.stringify(v));
  cache = null;
  return getSettings();
}
