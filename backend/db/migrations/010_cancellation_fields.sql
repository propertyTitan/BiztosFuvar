-- Lemondási flow támogatás: új oszlopok a jobs és route_bookings táblákon.
--
-- Szabályok (lásd SUPPORT_SYSTEM_PROMPT):
--   - Ha a FELADÓ mondja le a már kifizetett fuvart: 10% lemondási díj,
--     max 1000 Ft. A többit visszatérítjük.
--   - Ha a SOFŐR mondja le: 100% visszatérítés a feladónak.
--   - Ha még nem történt fizetés, semmilyen díj nincs.
--
-- A `cancellation_fee_huf` és `refund_huf` tárolja az elszámolást, hogy
-- a későbbi admin / NAV audit szempontjából visszakövethető legyen ki
-- mennyit fizetett vissza és miért.

ALTER TABLE jobs
    ADD COLUMN IF NOT EXISTS cancelled_at          TIMESTAMPTZ,
    ADD COLUMN IF NOT EXISTS cancelled_by          UUID REFERENCES users(id) ON DELETE SET NULL,
    ADD COLUMN IF NOT EXISTS cancel_reason         TEXT,
    ADD COLUMN IF NOT EXISTS cancellation_fee_huf  INTEGER NOT NULL DEFAULT 0,
    ADD COLUMN IF NOT EXISTS refund_huf            INTEGER NOT NULL DEFAULT 0;

ALTER TABLE route_bookings
    ADD COLUMN IF NOT EXISTS cancelled_at          TIMESTAMPTZ,
    ADD COLUMN IF NOT EXISTS cancelled_by          UUID REFERENCES users(id) ON DELETE SET NULL,
    ADD COLUMN IF NOT EXISTS cancel_reason         TEXT,
    ADD COLUMN IF NOT EXISTS cancellation_fee_huf  INTEGER NOT NULL DEFAULT 0,
    ADD COLUMN IF NOT EXISTS refund_huf            INTEGER NOT NULL DEFAULT 0;

CREATE INDEX IF NOT EXISTS idx_jobs_cancelled_at    ON jobs(cancelled_at);
CREATE INDEX IF NOT EXISTS idx_bookings_cancelled_at ON route_bookings(cancelled_at);
