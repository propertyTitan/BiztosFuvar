-- =====================================================================
--  030_recipient_route_bookings.sql
--
--  Címzett adatok a fix áras útvonal foglalásoknál is.
--  (A jobs táblán már van a 029-es migrációból.)
-- =====================================================================

ALTER TABLE route_bookings
    ADD COLUMN IF NOT EXISTS recipient_name   TEXT,
    ADD COLUMN IF NOT EXISTS recipient_phone  TEXT,
    ADD COLUMN IF NOT EXISTS recipient_email  TEXT,
    ADD COLUMN IF NOT EXISTS tracking_token   TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS idx_bookings_tracking_token
    ON route_bookings(tracking_token) WHERE tracking_token IS NOT NULL;
