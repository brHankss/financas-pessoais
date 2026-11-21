CREATE TABLE IF NOT EXISTS card_metadata (
  card_id TEXT NOT NULL PRIMARY KEY REFERENCES cards(id) ON DELETE CASCADE,
  brand TEXT,
  holder_name TEXT
);
