-- Vita / reklamáció kezelés.
--
-- Bármelyik fél megnyithat egy disputot, ha a fuvarral vagy a foglalással
-- probléma van (sérült csomag, nem kapott meg, nem egyezik a leírt súly,
-- stb.). Az admin (vagy későbbi automatikus rendszer) dönt: visszatérítés,
-- részleges refund, vagy a dispute elvetése.
--
-- A disputes tábla OPCIONÁLISAN kapcsolódik egy job-hoz VAGY egy
-- route_booking-hoz (mindkettő nullable).

CREATE TABLE IF NOT EXISTS disputes (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    -- Melyik entitásra vonatkozik (pontosan egy kitöltött)
    job_id          UUID REFERENCES jobs(id) ON DELETE CASCADE,
    booking_id      UUID REFERENCES route_bookings(id) ON DELETE CASCADE,
    -- Ki nyitotta a vitát
    opened_by       UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    -- A másik fél (akivel a vita van)
    against_user    UUID REFERENCES users(id) ON DELETE SET NULL,
    -- Szöveges leírás + opcionális bizonyíték-fotó URL
    description     TEXT NOT NULL,
    evidence_url    TEXT,
    -- Döntés
    status          TEXT NOT NULL DEFAULT 'open'
                    CHECK (status IN ('open', 'under_review', 'resolved_refund', 'resolved_no_action', 'resolved_partial', 'closed')),
    resolution_note TEXT,
    resolved_by     UUID REFERENCES users(id) ON DELETE SET NULL,
    resolved_at     TIMESTAMPTZ,
    -- Pénzmozgás: ha a döntés refund, mennyit
    refund_huf      INTEGER NOT NULL DEFAULT 0,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    -- Legalább egy entitás kell
    CHECK (job_id IS NOT NULL OR booking_id IS NOT NULL)
);

CREATE INDEX IF NOT EXISTS idx_disputes_job     ON disputes(job_id);
CREATE INDEX IF NOT EXISTS idx_disputes_booking ON disputes(booking_id);
CREATE INDEX IF NOT EXISTS idx_disputes_opened  ON disputes(opened_by);
CREATE INDEX IF NOT EXISTS idx_disputes_status  ON disputes(status);
