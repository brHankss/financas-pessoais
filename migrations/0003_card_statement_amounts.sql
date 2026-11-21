CREATE TABLE IF NOT EXISTS card_statement_amounts (purchase_id TEXT NOT NULL, month_key TEXT NOT NULL, cents INTEGER NOT NULL, PRIMARY KEY (purchase_id, month_key));
