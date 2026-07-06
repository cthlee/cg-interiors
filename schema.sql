-- CG Interiors — inquiries table (Cloudflare D1 / SQLite)
-- Apply:  wrangler d1 execute cg-interiors-inquiries --file=./schema.sql
--   local:  add --local     remote:  add --remote

CREATE TABLE IF NOT EXISTS inquiries (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  created_at   TEXT NOT NULL DEFAULT (datetime('now')),
  name         TEXT NOT NULL,
  email        TEXT NOT NULL,
  project_type TEXT,
  location     TEXT,
  budget       TEXT,
  message      TEXT NOT NULL,
  status       TEXT NOT NULL DEFAULT 'new',   -- new | read | replied | archived
  ip           TEXT,
  user_agent   TEXT
);

CREATE INDEX IF NOT EXISTS idx_inquiries_created ON inquiries (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_inquiries_status  ON inquiries (status);
