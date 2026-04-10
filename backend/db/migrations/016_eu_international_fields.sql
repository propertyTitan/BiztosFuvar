-- GoFuvar EU Fázis 1: Nemzetközi alapok.
--
-- Ez a migráció a belföldi MVP-t "EU-ready" állapotba hozza:
--   1) jobs: country_code + currency + category + urgency_level
--   2) carrier_routes: countries[] + capacity + return_trip + is_international
--   3) users: locale + service_categories[] + billing adatok
--   4) route_bookings: currency
--
-- A meglévő adatok HU / HUF default-ot kapnak — semmi nem törik el.

-- ============ JOBS ============
ALTER TABLE jobs
    ADD COLUMN IF NOT EXISTS country_code    TEXT NOT NULL DEFAULT 'HU',
    ADD COLUMN IF NOT EXISTS currency        TEXT NOT NULL DEFAULT 'HUF',
    ADD COLUMN IF NOT EXISTS category        TEXT NOT NULL DEFAULT 'standard',
    ADD COLUMN IF NOT EXISTS urgency_level   TEXT NOT NULL DEFAULT 'normal';

COMMENT ON COLUMN jobs.category IS 'standard | urgent_tow | international_transit';
COMMENT ON COLUMN jobs.urgency_level IS 'normal | urgent | sos';

CREATE INDEX IF NOT EXISTS idx_jobs_country  ON jobs(country_code);
CREATE INDEX IF NOT EXISTS idx_jobs_category ON jobs(category);

-- ============ CARRIER ROUTES ============
ALTER TABLE carrier_routes
    ADD COLUMN IF NOT EXISTS is_international       BOOLEAN NOT NULL DEFAULT false,
    ADD COLUMN IF NOT EXISTS countries               TEXT[] DEFAULT '{HU}',
    ADD COLUMN IF NOT EXISTS available_capacity_kg   NUMERIC(8,2),
    ADD COLUMN IF NOT EXISTS available_capacity_m3   NUMERIC(8,2),
    ADD COLUMN IF NOT EXISTS return_trip             BOOLEAN NOT NULL DEFAULT false,
    ADD COLUMN IF NOT EXISTS currency                TEXT NOT NULL DEFAULT 'HUF';

CREATE INDEX IF NOT EXISTS idx_routes_international ON carrier_routes(is_international);
CREATE INDEX IF NOT EXISTS idx_routes_countries     ON carrier_routes USING GIN(countries);

-- ============ ROUTE BOOKINGS ============
ALTER TABLE route_bookings
    ADD COLUMN IF NOT EXISTS currency TEXT NOT NULL DEFAULT 'HUF';

-- ============ USERS — nemzetközi profil ============
ALTER TABLE users
    ADD COLUMN IF NOT EXISTS locale              TEXT NOT NULL DEFAULT 'hu',
    ADD COLUMN IF NOT EXISTS service_categories  TEXT[] DEFAULT '{standard}',
    ADD COLUMN IF NOT EXISTS tax_id              TEXT,
    ADD COLUMN IF NOT EXISTS company_name        TEXT,
    ADD COLUMN IF NOT EXISTS billing_address     TEXT,
    ADD COLUMN IF NOT EXISTS billing_country     TEXT DEFAULT 'HU',
    ADD COLUMN IF NOT EXISTS last_known_lat      DOUBLE PRECISION,
    ADD COLUMN IF NOT EXISTS last_known_lng      DOUBLE PRECISION,
    ADD COLUMN IF NOT EXISTS last_ping_at        TIMESTAMPTZ;

COMMENT ON COLUMN users.locale IS 'hu | en | de | fr | it | pl | es';
COMMENT ON COLUMN users.service_categories IS '{standard,urgent_tow,international_transit}';
COMMENT ON COLUMN users.last_known_lat IS 'Legutolsó GPS — a geo-push-hoz (SOS értesítés)';

CREATE INDEX IF NOT EXISTS idx_users_locale     ON users(locale);
CREATE INDEX IF NOT EXISTS idx_users_categories ON users USING GIN(service_categories);
CREATE INDEX IF NOT EXISTS idx_users_geo        ON users(last_known_lat, last_known_lng)
    WHERE last_known_lat IS NOT NULL;

-- ============ ESCROW ============
ALTER TABLE escrow_transactions
    ADD COLUMN IF NOT EXISTS currency TEXT NOT NULL DEFAULT 'HUF';
