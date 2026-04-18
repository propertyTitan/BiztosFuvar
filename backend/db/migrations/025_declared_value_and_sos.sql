-- =====================================================================
--  025_declared_value_and_sos.sql
--
--  1) Csomag értékmegadás: a feladó deklarálja a csomag értékét.
--     Nem a platform felelőssége, hanem a sofőr-feladó közötti
--     felelősségi alap. A sofőr ez alapján dönti el, elvállalja-e.
--
--  2) SOS rendszer: bármelyik fél vészhelyzetben jelezhet.
--     GPS + timestamp + opcionális leírás logolva.
-- =====================================================================

-- Csomag deklarált érték
ALTER TABLE jobs
    ADD COLUMN IF NOT EXISTS declared_value_huf INTEGER;

COMMENT ON COLUMN jobs.declared_value_huf IS
  'A feladó által deklarált csomag-érték (Ft). A sofőr felelőssége eddig terjed.';

-- SOS események tábla
CREATE TABLE IF NOT EXISTS sos_events (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id     UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    job_id      UUID REFERENCES jobs(id) ON DELETE SET NULL,
    booking_id  UUID REFERENCES route_bookings(id) ON DELETE SET NULL,
    lat         DOUBLE PRECISION,
    lng         DOUBLE PRECISION,
    message     TEXT,
    resolved    BOOLEAN NOT NULL DEFAULT FALSE,
    resolved_by UUID REFERENCES users(id) ON DELETE SET NULL,
    resolved_at TIMESTAMPTZ,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_sos_user    ON sos_events(user_id);
CREATE INDEX IF NOT EXISTS idx_sos_unresolved ON sos_events(resolved) WHERE resolved = FALSE;
