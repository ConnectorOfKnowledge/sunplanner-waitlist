-- P8: newsletter front door. Adds consent, contact, and suppression columns to the
-- existing signups table. Additive only -- no existing column, row, or the
-- UNIQUE(email, platform) key changes. Applied 2026-07-20 via:
--   npx wrangler d1 execute sunplanner-waitlist --remote --file=migrations/20260720_001_newsletter_columns.sql

ALTER TABLE signups ADD COLUMN newsletter_consent INTEGER NOT NULL DEFAULT 0;
ALTER TABLE signups ADD COLUMN phone TEXT;
ALTER TABLE signups ADD COLUMN source TEXT NOT NULL DEFAULT 'waitlist';
ALTER TABLE signups ADD COLUMN suppressed INTEGER NOT NULL DEFAULT 0;
