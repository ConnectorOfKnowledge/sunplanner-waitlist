-- SunPlanner waitlist signups table (MySQL)
-- Run this once in Hostinger phpMyAdmin after creating the database:
--   hPanel > Databases > phpMyAdmin > select your database > SQL tab > paste and run

CREATE TABLE IF NOT EXISTS signups (
  id         INT UNSIGNED  NOT NULL AUTO_INCREMENT,
  email      VARCHAR(254)  NOT NULL,
  platform   VARCHAR(10)   NOT NULL DEFAULT 'android',
  created_at DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_email_platform (email, platform)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- If the table already exists from a prior deploy, run this migration instead:
--   ALTER TABLE signups
--     ADD COLUMN platform VARCHAR(10) NOT NULL DEFAULT 'android' AFTER email,
--     DROP INDEX uq_email,
--     ADD UNIQUE KEY uq_email_platform (email, platform);

-- To export all signups as CSV from phpMyAdmin:
--   Run:  SELECT email, platform, created_at FROM signups ORDER BY created_at DESC;
--   Then: Export tab > Format: CSV > Go
