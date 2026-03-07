const Database = require('better-sqlite3');
const path = require('path');
const fs = require('fs');

const DB_PATH = process.env.DB_PATH || path.join(__dirname, '..', 'data', 'sentquote.db');

// Ensure data directory exists
fs.mkdirSync(path.dirname(DB_PATH), { recursive: true });

const db = new Database(DB_PATH);

// Enable WAL mode for better concurrent performance
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

// Create tables
const migrations = [
  // Users table
  `CREATE TABLE IF NOT EXISTS users (
    id TEXT PRIMARY KEY,
    email TEXT UNIQUE NOT NULL,
    password_hash TEXT NOT NULL,
    business_name TEXT DEFAULT '',
    stripe_account_id TEXT,
    stripe_connected INTEGER DEFAULT 0,
    plan TEXT DEFAULT 'free',
    created_at TEXT DEFAULT (datetime('now')),
    updated_at TEXT DEFAULT (datetime('now'))
  )`,

  // Quotes table
  `CREATE TABLE IF NOT EXISTS quotes (
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
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
  )`,

  // Quote events table
  `CREATE TABLE IF NOT EXISTS quote_events (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    quote_id TEXT NOT NULL,
    event_type TEXT NOT NULL,
    metadata TEXT DEFAULT '{}',
    ip_address TEXT,
    user_agent TEXT,
    created_at TEXT DEFAULT (datetime('now')),
    FOREIGN KEY (quote_id) REFERENCES quotes(id) ON DELETE CASCADE
  )`,

  // Followups table
  `CREATE TABLE IF NOT EXISTS followups (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    quote_id TEXT NOT NULL,
    scheduled_at TEXT NOT NULL,
    sent_at TEXT,
    message TEXT,
    status TEXT DEFAULT 'pending',
    FOREIGN KEY (quote_id) REFERENCES quotes(id) ON DELETE CASCADE
  )`,

  // Password resets table
  `CREATE TABLE IF NOT EXISTS password_resets (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id TEXT NOT NULL,
    token TEXT UNIQUE NOT NULL,
    expires_at TEXT NOT NULL,
    used_at TEXT,
    created_at TEXT DEFAULT (datetime('now')),
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
  )`,

  // User notification preferences
  `CREATE TABLE IF NOT EXISTS user_settings (
    user_id TEXT PRIMARY KEY,
    notify_on_view INTEGER DEFAULT 1,
    notify_on_accept INTEGER DEFAULT 1,
    notify_on_pay INTEGER DEFAULT 1,
    min_view_interval_minutes INTEGER DEFAULT 60,
    created_at TEXT DEFAULT (datetime('now')),
    updated_at TEXT DEFAULT (datetime('now')),
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
  )`,

  // Indexes
  `CREATE INDEX IF NOT EXISTS idx_quotes_user ON quotes(user_id)`,
  `CREATE INDEX IF NOT EXISTS idx_quotes_slug ON quotes(slug)`,
  `CREATE INDEX IF NOT EXISTS idx_quotes_status ON quotes(status)`,
  `CREATE INDEX IF NOT EXISTS idx_quotes_created ON quotes(created_at)`,
  `CREATE INDEX IF NOT EXISTS idx_events_quote ON quote_events(quote_id)`,
  `CREATE INDEX IF NOT EXISTS idx_events_created ON quote_events(created_at)`,
  `CREATE INDEX IF NOT EXISTS idx_followups_status ON followups(status)`,
  `CREATE INDEX IF NOT EXISTS idx_followups_scheduled ON followups(scheduled_at)`,
  `CREATE INDEX IF NOT EXISTS idx_password_resets_token ON password_resets(token)`,
  `CREATE INDEX IF NOT EXISTS idx_password_resets_expires ON password_resets(expires_at)`,
  `CREATE INDEX IF NOT EXISTS idx_user_settings_user ON user_settings(user_id)`,

  // Templates table
  `CREATE TABLE IF NOT EXISTS templates (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL,
    name TEXT NOT NULL,
    description TEXT DEFAULT '',
    line_items TEXT NOT NULL DEFAULT '[]',
    tax_rate REAL DEFAULT 0,
    deposit_percent INTEGER DEFAULT 50,
    notes TEXT DEFAULT '',
    created_at TEXT DEFAULT (datetime('now')),
    updated_at TEXT DEFAULT (datetime('now')),
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
  )`,
  `CREATE INDEX IF NOT EXISTS idx_templates_user ON templates(user_id)`
];

// Run migrations
db.transaction(() => {
  for (const migration of migrations) {
    db.exec(migration);
  }
})();

// Cleanup expired password resets periodically
function cleanupExpiredTokens() {
  try {
    const result = db.prepare(
      "DELETE FROM password_resets WHERE expires_at < datetime('now') AND used_at IS NULL"
    ).run();
    if (result.changes > 0) {
      console.log(`Cleaned up ${result.changes} expired password reset tokens`);
    }
  } catch (err) {
    console.error('Failed to cleanup expired tokens:', err);
  }
}

// Run cleanup every hour
setInterval(cleanupExpiredTokens, 60 * 60 * 1000);

module.exports = db;
