import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { config } from './config.js';

if (config.dbPath !== ':memory:') mkdirSync(dirname(config.dbPath), { recursive: true });

export const db = new DatabaseSync(config.dbPath);
db.exec(`
  PRAGMA journal_mode = WAL;
  PRAGMA foreign_keys = ON;

  CREATE TABLE IF NOT EXISTS users (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    email         TEXT NOT NULL UNIQUE,
    name          TEXT NOT NULL,
    password_hash TEXT NOT NULL,
    created_at    TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS bookings (
    ref               TEXT PRIMARY KEY,
    user_id           INTEGER NOT NULL REFERENCES users(id),
    type              TEXT NOT NULL CHECK (type IN ('flight','hotel')),
    status            TEXT NOT NULL,
    provider          TEXT NOT NULL,
    provider_order_id TEXT,
    provider_ref      TEXT,
    total             REAL NOT NULL,
    currency          TEXT NOT NULL,
    summary           TEXT NOT NULL,
    details           TEXT NOT NULL,
    refund_amount     REAL,
    created_at        TEXT NOT NULL DEFAULT (datetime('now')),
    cancelled_at      TEXT
  );

  CREATE TABLE IF NOT EXISTS payments (
    id          TEXT PRIMARY KEY,
    booking_ref TEXT,
    provider    TEXT NOT NULL,
    amount      REAL NOT NULL,
    currency    TEXT NOT NULL,
    status      TEXT NOT NULL,
    card_last4  TEXT,
    created_at  TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS agents (
    user_id        INTEGER PRIMARY KEY REFERENCES users(id),
    agency         TEXT NOT NULL,
    commission_pct REAL NOT NULL DEFAULT 1.5,
    wallet_balance REAL NOT NULL DEFAULT 0,
    credit_limit   REAL NOT NULL DEFAULT 0,
    status         TEXT NOT NULL DEFAULT 'pending',
    created_at     TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS customers (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    agent_id   INTEGER NOT NULL REFERENCES users(id),
    name       TEXT NOT NULL,
    email      TEXT,
    phone      TEXT,
    notes      TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS wallet_txns (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    agent_id      INTEGER NOT NULL REFERENCES users(id),
    type          TEXT NOT NULL,
    amount        REAL NOT NULL,
    balance_after REAL NOT NULL,
    booking_ref   TEXT,
    note          TEXT,
    created_at    TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT NOT NULL);

  CREATE TABLE IF NOT EXISTS audit (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id    INTEGER,
    user_name  TEXT,
    action     TEXT NOT NULL,
    entity     TEXT,
    entity_id  TEXT,
    meta       TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS search_log (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id    INTEGER,
    kind       TEXT NOT NULL,
    key        TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS saved_travellers (
    id      INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL REFERENCES users(id),
    data    TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS promo_codes (
    code         TEXT PRIMARY KEY,
    description  TEXT NOT NULL,
    type         TEXT NOT NULL CHECK (type IN ('percent','flat')),
    value        REAL NOT NULL,
    min_total    REAL NOT NULL DEFAULT 0,
    max_discount REAL,
    applies_to   TEXT NOT NULL DEFAULT 'all',
    max_uses     INTEGER,
    used         INTEGER NOT NULL DEFAULT 0,
    expires_at   TEXT,
    active       INTEGER NOT NULL DEFAULT 1,
    created_at   TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS points_txns (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id     INTEGER NOT NULL REFERENCES users(id),
    points      INTEGER NOT NULL,
    type        TEXT NOT NULL,
    booking_ref TEXT,
    note        TEXT,
    created_at  TEXT NOT NULL DEFAULT (datetime('now'))
  );
  CREATE INDEX IF NOT EXISTS idx_points_user ON points_txns(user_id, id DESC);

  CREATE TABLE IF NOT EXISTS tickets (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id     INTEGER NOT NULL REFERENCES users(id),
    booking_ref TEXT,
    subject     TEXT NOT NULL,
    status      TEXT NOT NULL DEFAULT 'open',
    created_at  TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at  TEXT NOT NULL DEFAULT (datetime('now'))
  );
  CREATE TABLE IF NOT EXISTS ticket_messages (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    ticket_id   INTEGER NOT NULL REFERENCES tickets(id),
    user_id     INTEGER NOT NULL REFERENCES users(id),
    author_role TEXT NOT NULL,
    body        TEXT NOT NULL,
    created_at  TEXT NOT NULL DEFAULT (datetime('now'))
  );
`);

// Adds a column to an existing table when it is missing, so older databases keep working.
function addColumn(table, col, def) {
  const have = db.prepare(`PRAGMA table_info(${table})`).all().map((c) => c.name);
  if (!have.includes(col)) db.exec(`ALTER TABLE ${table} ADD COLUMN ${col} ${def}`);
}
addColumn('users', 'role', "TEXT NOT NULL DEFAULT 'customer'");
addColumn('users', 'phone', 'TEXT');
addColumn('users', 'status', "TEXT NOT NULL DEFAULT 'active'");
addColumn('bookings', 'agent_id', 'INTEGER');
addColumn('bookings', 'customer_id', 'INTEGER');
addColumn('bookings', 'customer_name', 'TEXT');
addColumn('bookings', 'customer_email', 'TEXT');
addColumn('bookings', 'channel', "TEXT NOT NULL DEFAULT 'direct'");
addColumn('bookings', 'supplier_total', 'REAL');
addColumn('bookings', 'markup', 'REAL NOT NULL DEFAULT 0');
addColumn('bookings', 'service_fee', 'REAL NOT NULL DEFAULT 0');
addColumn('bookings', 'commission', 'REAL NOT NULL DEFAULT 0');
addColumn('bookings', 'payment_mode', "TEXT NOT NULL DEFAULT 'card'");
addColumn('bookings', 'route', 'TEXT');
addColumn('bookings', 'start_date', 'TEXT');
addColumn('bookings', 'discount', 'REAL NOT NULL DEFAULT 0');
addColumn('bookings', 'promo_code', 'TEXT');
addColumn('bookings', 'points_used', 'INTEGER NOT NULL DEFAULT 0');
addColumn('bookings', 'points_earned', 'INTEGER NOT NULL DEFAULT 0');

db.exec(`
  CREATE INDEX IF NOT EXISTS idx_bookings_user ON bookings(user_id, created_at DESC);
  CREATE INDEX IF NOT EXISTS idx_bookings_agent ON bookings(agent_id, created_at DESC);
  CREATE INDEX IF NOT EXISTS idx_bookings_created ON bookings(created_at);
  CREATE INDEX IF NOT EXISTS idx_search_created ON search_log(created_at);
  CREATE INDEX IF NOT EXISTS idx_wallet_agent ON wallet_txns(agent_id, id DESC);
`);

export const round2 = (n) => Math.round(n * 100) / 100;
export function tx(fn) {
  db.exec('BEGIN');
  try { const r = fn(); db.exec('COMMIT'); return r; } catch (e) { db.exec('ROLLBACK'); throw e; }
}
