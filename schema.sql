-- SunPlanner waitlist signups table
-- Run once after creating the D1 database:
--   wrangler d1 execute sunplanner-waitlist --file=./schema.sql --remote

CREATE TABLE IF NOT EXISTS signups (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  email      TEXT    NOT NULL UNIQUE,
  created_at TEXT    NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_signups_created_at ON signups (created_at DESC);
