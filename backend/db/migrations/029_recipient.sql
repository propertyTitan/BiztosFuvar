-- =====================================================================
--  029_recipient.sql — Címzett adatai + publikus tracking token
--
--  A feladó megadhatja a címzett nevét, telefonszámát, email-jét.
--  A rendszer automatikusan SMS-t / emailt küld a címzettnek a
--  tracking linkkel és az átvételi kóddal.
--
--  A tracking_token egy egyedi, nem kitalálható token, amit a
--  publikus tracking oldalon használunk (nincs bejelentkezés).
-- =====================================================================

ALTER TABLE jobs
    ADD COLUMN IF NOT EXISTS recipient_name   TEXT,
    ADD COLUMN IF NOT EXISTS recipient_phone  TEXT,
    ADD COLUMN IF NOT EXISTS recipient_email  TEXT,
    ADD COLUMN IF NOT EXISTS tracking_token   TEXT;

-- Egyedi tracking token index
CREATE UNIQUE INDEX IF NOT EXISTS idx_jobs_tracking_token
    ON jobs(tracking_token) WHERE tracking_token IS NOT NULL;
