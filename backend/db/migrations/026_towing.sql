-- =====================================================================
--  026_towing.sql — Autómentés / Mobilgumis rendszer
--
--  Teljesen új szolgáltatási kategória: a bajba jutott autós egy
--  gombnyomással hívhat autómentőst vagy mobilgumist. GPS-alapú
--  push a közeli mentős-sofőröknek, első-elfogadó-nyer.
-- =====================================================================

-- Mentési kérések táblája — a jobs-tól különálló, mert teljesen más
-- adatszerkezet (nincs csomag méret, nincs pickup/dropoff, csak pozíció).
CREATE TABLE IF NOT EXISTS tow_requests (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    requester_id    UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    responder_id    UUID REFERENCES users(id) ON DELETE SET NULL,

    -- Hol van a bajba jutott
    lat             DOUBLE PRECISION NOT NULL,
    lng             DOUBLE PRECISION NOT NULL,
    address         TEXT,

    -- Mi a baj
    issue_type      TEXT NOT NULL DEFAULT 'breakdown',
    -- breakdown: lerobbanás
    -- flat_tire: defekt (mobilgumis kell)
    -- accident: baleset utáni mentés
    -- ditch: árokba csúszás / elakadás
    -- battery: akkumulátor lemerülés / begyújtás
    -- lockout: bezárt kulcs
    -- fuel: kifogyott az üzemanyag
    -- other: egyéb

    issue_description TEXT,

    -- Milyen jármű
    vehicle_type    TEXT NOT NULL DEFAULT 'car',
    -- car: személyautó
    -- van: kisbusz / kisteherautó
    -- truck: teherautó
    -- motorcycle: motor

    vehicle_plate   TEXT,

    -- Keresési sugár (km) a mentős push-hoz
    search_radius_km INTEGER NOT NULL DEFAULT 30,

    -- Állapot
    status          TEXT NOT NULL DEFAULT 'searching',
    -- searching: keresünk mentőst
    -- accepted: valaki elvállalta, úton van
    -- arrived: mentős megérkezett
    -- completed: mentés kész
    -- cancelled: a kérő lemondta
    -- expired: senki nem vállalta (timeout)

    -- Árazás — a mentős adja meg az elfogadásnál
    estimated_price_huf INTEGER,
    final_price_huf     INTEGER,

    -- Időbélyegek
    accepted_at     TIMESTAMPTZ,
    arrived_at      TIMESTAMPTZ,
    completed_at    TIMESTAMPTZ,
    cancelled_at    TIMESTAMPTZ,
    expires_at      TIMESTAMPTZ,  -- alap: created_at + 30 perc
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_tow_requester    ON tow_requests(requester_id);
CREATE INDEX IF NOT EXISTS idx_tow_responder    ON tow_requests(responder_id);
CREATE INDEX IF NOT EXISTS idx_tow_status       ON tow_requests(status);
CREATE INDEX IF NOT EXISTS idx_tow_geo          ON tow_requests(lat, lng);
CREATE INDEX IF NOT EXISTS idx_tow_searching    ON tow_requests(status, created_at)
    WHERE status = 'searching';

-- Mentős-sofőrök extra adatai (kiegészítés a users táblához)
ALTER TABLE users
    ADD COLUMN IF NOT EXISTS is_tow_driver       BOOLEAN NOT NULL DEFAULT FALSE,
    ADD COLUMN IF NOT EXISTS tow_services        TEXT[] DEFAULT '{}',
    -- tow_services: milyen mentést vállal
    -- '{breakdown,flat_tire,battery,ditch,accident,lockout,fuel}'
    ADD COLUMN IF NOT EXISTS tow_vehicle_description TEXT,
    ADD COLUMN IF NOT EXISTS tow_available       BOOLEAN NOT NULL DEFAULT FALSE;
    -- tow_available: jelenleg elérhető-e (a mentős be/kikapcsolja)

COMMENT ON COLUMN users.is_tow_driver IS 'Autómentős / mobilgumis regisztráció';
COMMENT ON COLUMN users.tow_services IS 'Milyen típusú mentéseket vállal';
COMMENT ON COLUMN users.tow_available IS 'Jelenleg elérhető-e (online/offline toggle)';

CREATE INDEX IF NOT EXISTS idx_users_tow_driver
    ON users(is_tow_driver, tow_available)
    WHERE is_tow_driver = TRUE;
