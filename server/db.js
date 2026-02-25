const Database = require('better-sqlite3');
const path = require('path');

const DB_PATH = process.env.DB_PATH || path.join(__dirname, '..', 'data', 'sentquote.db');

// Ensure data directory exists
const fs = require('fs');
fs.mkdirSync(path.dirname(DB_PATH), { recursive: true });

const db = new Database(DB_PATH);

// Enable WAL mode for better concurrent performance
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

// Create tables
db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id TEXT PRIMARY KEY,
    email TEXT UNIQUE NOT NULL,
    password_hash TEXT NOT NULL,
    business_name TEXT DEFAULT '',
    stripe_account_id TEXT,
    stripe_connected INTEGER DEFAULT 0,
    plan TEXT DEFAULT 'free',
    created_at TEXT DEFAULT (datetime('now')),
    updated_at TEXT DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS quotes (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL,
    slug TEXT UNIQUE NOT NULL,
    client_name TEXT NOT NULL,
    client_email TEXT NOT NULL,
    title TEXT NOT NULL,
    description TEXT DEFAULT '',
    line_items TEXT NOT NULL DEFAULT '[]',
    subtotal INTEGER NOT NULL DEFAULT 0,
    tax_rate REAL DEFAULT 0,
    tax_amount INTEGER DEFAULT 0,
    total INTEGER NOT NULL DEFAULT 0,
    currency TEXT DEFAULT 'usd',
    deposit_percent INTEGER DEFAULT 0,
    deposit_amount INTEGER DEFAULT 0,
    valid_until TEXT,
    status TEXT DEFAULT 'draft',
    accepted_at TEXT,
    paid_at TEXT,
    paid_amount INTEGER DEFAULT 0,
    stripe_payment_intent TEXT,
    notes TEXT DEFAULT '',
    view_count INTEGER DEFAULT 0,
    first_viewed_at TEXT,
    last_viewed_at TEXT,
    created_at TEXT DEFAULT (datetime('now')),
    updated_at TEXT DEFAULT (datetime('now')),
    FOREIGN KEY (user_id) REFERENCES users(id)
  );

  CREATE TABLE IF NOT EXISTS quote_events (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    quote_id TEXT NOT NULL,
    event_type TEXT NOT NULL,
    metadata TEXT DEFAULT '{}',
    ip_address TEXT,
    user_agent TEXT,
    created_at TEXT DEFAULT (datetime('now')),
    FOREIGN KEY (quote_id) REFERENCES quotes(id)
  );

  CREATE TABLE IF NOT EXISTS followups (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    quote_id TEXT NOT NULL,
    scheduled_at TEXT NOT NULL,
    sent_at TEXT,
    message TEXT,
    status TEXT DEFAULT 'pending',
    FOREIGN KEY (quote_id) REFERENCES quotes(id)
  );

  CREATE INDEX IF NOT EXISTS idx_quotes_user ON quotes(user_id);
  CREATE INDEX IF NOT EXISTS idx_quotes_slug ON quotes(slug);
  CREATE INDEX IF NOT EXISTS idx_quotes_status ON quotes(status);
  CREATE INDEX IF NOT EXISTS idx_events_quote ON quote_events(quote_id);
`);

module.exports = db;
