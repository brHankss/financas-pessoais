-- Melhorias: vínculos Pluggy <-> cadastros manuais, controle de saldo disponível,
-- transações individuais do Meu Pluggy e deduplicação determinística de faturas.

CREATE TABLE IF NOT EXISTS pluggy_config (
  id INTEGER PRIMARY KEY,
  prefs TEXT NOT NULL,
  revision INTEGER NOT NULL DEFAULT 0,
  last_sync TEXT,
  status TEXT
);

CREATE TABLE IF NOT EXISTS pluggy_positions (
  id TEXT PRIMARY KEY,
  item TEXT NOT NULL,
  category TEXT NOT NULL,
  payload TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS pluggy_excluded (
  id TEXT PRIMARY KEY
);

CREATE TABLE IF NOT EXISTS pluggy_links (
  pluggy_id TEXT PRIMARY KEY,
  category TEXT NOT NULL,
  target_id TEXT NOT NULL,
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS pluggy_synced_tx (
  pluggy_tx_id TEXT PRIMARY KEY,
  pluggy_account_id TEXT NOT NULL,
  kind TEXT NOT NULL,
  local_id TEXT NOT NULL,
  tx_date TEXT NOT NULL,
  synced_at TEXT NOT NULL DEFAULT (datetime('now'))
);

ALTER TABLE accounts ADD COLUMN include_in_cash INTEGER NOT NULL DEFAULT 1;
ALTER TABLE bank_transactions ADD COLUMN source TEXT NOT NULL DEFAULT 'manual';
ALTER TABLE bank_transactions ADD COLUMN external_id TEXT;
ALTER TABLE card_purchases ADD COLUMN source TEXT NOT NULL DEFAULT 'manual';
ALTER TABLE card_purchases ADD COLUMN external_id TEXT;
ALTER TABLE card_purchases ADD COLUMN import_key TEXT;

CREATE INDEX IF NOT EXISTS idx_pluggy_links_target ON pluggy_links(category, target_id);
CREATE INDEX IF NOT EXISTS idx_pluggy_synced_tx_local ON pluggy_synced_tx(kind, local_id);
CREATE INDEX IF NOT EXISTS idx_bank_tx_external ON bank_transactions(external_id);
CREATE INDEX IF NOT EXISTS idx_card_purchases_external ON card_purchases(external_id);
CREATE INDEX IF NOT EXISTS idx_card_purchases_import_key ON card_purchases(import_key);
