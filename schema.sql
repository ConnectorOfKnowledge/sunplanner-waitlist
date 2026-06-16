-- SunPlanner waitlist signups table (MySQL)
-- Run this once in Hostinger phpMyAdmin after creating the database:
--   hPanel > Databases > phpMyAdmin > select your database > SQL tab > paste and run

CREATE TABLE IF NOT EXISTS signups (
  id         INT UNSIGNED  NOT NULL AUTO_INCREMENT,
  email      VARCHAR(254)  NOT NULL,
  created_at DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_email (email)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- To export all signups as CSV from phpMyAdmin:
--   Run:  SELECT email, created_at FROM signups ORDER BY created_at DESC;
--   Then: Export tab > Format: CSV > Go
