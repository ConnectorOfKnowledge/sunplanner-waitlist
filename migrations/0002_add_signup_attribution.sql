-- Additive only: existing waitlist records remain untouched and continue to
-- read as historical/unattributed in the company dashboard. The existing
-- `source` column belongs to the signup/newsletter system, so campaign data
-- uses distinct names and cannot overwrite or conflict with it.
ALTER TABLE signups ADD COLUMN campaign_source TEXT;
ALTER TABLE signups ADD COLUMN campaign_medium TEXT;
ALTER TABLE signups ADD COLUMN landing_path TEXT;
