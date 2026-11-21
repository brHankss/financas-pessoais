-- Finanças Pessoais — Schema inicial para Cloudflare D1 (SQLite)
-- Compatível com wrangler d1 migrations apply e auto-bootstrap do Worker.

CREATE TABLE IF NOT EXISTS app_settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS accounts (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  balance REAL NOT NULL DEFAULT 0,
  color TEXT NOT NULL DEFAULT '#3B82F6',
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS cards (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  institution TEXT NOT NULL DEFAULT 'Manual',
  last4 TEXT NOT NULL DEFAULT '0000',
  credit_limit REAL NOT NULL DEFAULT 0,
  close_day INTEGER NOT NULL DEFAULT 1,
  due_day INTEGER NOT NULL DEFAULT 10,
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS people (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'Família',
  is_owner INTEGER NOT NULL DEFAULT 0,
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS card_purchases (
  id TEXT PRIMARY KEY,
  card_id TEXT NOT NULL,
  purchase_date TEXT NOT NULL,
  start_month TEXT NOT NULL,
  description TEXT NOT NULL,
  category TEXT NOT NULL DEFAULT 'Outros',
  total_cents INTEGER NOT NULL DEFAULT 0,
  installments INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (card_id) REFERENCES cards(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS card_purchase_splits (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  purchase_id TEXT NOT NULL,
  person_id TEXT NOT NULL,
  cents INTEGER NOT NULL DEFAULT 0,
  FOREIGN KEY (purchase_id) REFERENCES card_purchases(id) ON DELETE CASCADE,
  FOREIGN KEY (person_id) REFERENCES people(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS person_events (
  id TEXT PRIMARY KEY,
  person_id TEXT NOT NULL,
  month_key TEXT NOT NULL,
  event_type TEXT NOT NULL,
  cents INTEGER NOT NULL DEFAULT 0,
  event_date TEXT NOT NULL,
  account_id TEXT,
  note TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (person_id) REFERENCES people(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS fixed_incomes (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  amount REAL NOT NULL DEFAULT 0,
  pay_day INTEGER NOT NULL DEFAULT 5,
  account_id TEXT NOT NULL,
  received_months_json TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS bank_transactions (
  id TEXT PRIMARY KEY,
  tx_date TEXT NOT NULL,
  description TEXT NOT NULL,
  tx_type TEXT NOT NULL,
  category TEXT NOT NULL DEFAULT 'Outros',
  account_id TEXT NOT NULL,
  amount REAL NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS investments (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  rate_type TEXT NOT NULL DEFAULT 'CDI',
  rate_val REAL NOT NULL DEFAULT 100,
  tax_free INTEGER NOT NULL DEFAULT 0,
  gross REAL NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS sessions (
  token_hash TEXT PRIMARY KEY,
  device_name TEXT NOT NULL DEFAULT 'Navegador',
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  expires_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_card_purchases_card ON card_purchases(card_id);
CREATE INDEX IF NOT EXISTS idx_card_purchases_month ON card_purchases(start_month);
CREATE INDEX IF NOT EXISTS idx_splits_purchase ON card_purchase_splits(purchase_id);
CREATE INDEX IF NOT EXISTS idx_person_events_person_month ON person_events(person_id, month_key);
CREATE INDEX IF NOT EXISTS idx_bank_tx_date ON bank_transactions(tx_date);
CREATE INDEX IF NOT EXISTS idx_sessions_expires ON sessions(expires_at);
