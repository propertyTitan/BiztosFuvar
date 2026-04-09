-- =====================================================================
--  GoFuvar – PostgreSQL séma
--  Felhasználók, fuvarok, licitek, fotók, értékelések, escrow tranzakciók.
-- =====================================================================

CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- ---------- ENUM típusok ----------------------------------------------

DO $$ BEGIN
    CREATE TYPE user_role AS ENUM ('shipper', 'carrier', 'admin');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
    CREATE TYPE job_status AS ENUM (
        'pending',      -- létrehozva, még nincs licit
        'bidding',      -- aktív licitálás
        'accepted',     -- sofőr elfogadva, letét lefoglalva
        'in_progress',  -- felvétel megtörtént, úton
        'delivered',    -- lerakodva, validálva
        'completed',    -- kifizetve, lezárva
        'disputed',     -- vita / panasz
        'cancelled'
    );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
    CREATE TYPE bid_status AS ENUM ('pending', 'accepted', 'rejected', 'withdrawn');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
    CREATE TYPE photo_kind AS ENUM ('listing', 'pickup', 'dropoff', 'damage', 'document');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
    CREATE TYPE escrow_status AS ENUM ('held', 'released', 'refunded');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ---------- Felhasználók ----------------------------------------------

CREATE TABLE IF NOT EXISTS users (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    role            user_role NOT NULL,
    email           TEXT UNIQUE NOT NULL,
    password_hash   TEXT NOT NULL,
    full_name       TEXT NOT NULL,
    phone           TEXT,
    -- carrier-specifikus mezők
    vehicle_type    TEXT,
    vehicle_plate   TEXT,
    license_doc_url TEXT,
    is_verified     BOOLEAN NOT NULL DEFAULT FALSE,
    rating_avg      NUMERIC(3,2) NOT NULL DEFAULT 0,
    rating_count    INTEGER NOT NULL DEFAULT 0,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_users_role ON users(role);

-- ---------- Fuvarok (Jobs) --------------------------------------------

CREATE TABLE IF NOT EXISTS jobs (
    id                   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    shipper_id           UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    carrier_id           UUID REFERENCES users(id) ON DELETE SET NULL,
    title                TEXT NOT NULL,
    description          TEXT,
    -- felvételi pont
    pickup_address       TEXT NOT NULL,
    pickup_lat           DOUBLE PRECISION NOT NULL,
    pickup_lng           DOUBLE PRECISION NOT NULL,
    -- lerakodási pont
    dropoff_address      TEXT NOT NULL,
    dropoff_lat          DOUBLE PRECISION NOT NULL,
    dropoff_lng          DOUBLE PRECISION NOT NULL,
    -- fuvar paraméterek
    distance_km          NUMERIC(8,2),
    weight_kg            NUMERIC(8,2),
    volume_m3            NUMERIC(8,2),
    -- csomag-méretek centiméterben (kötelező új fuvaroknál – lásd jobs.js)
    length_cm            INTEGER,
    width_cm             INTEGER,
    height_cm            INTEGER,
    suggested_price_huf  INTEGER,
    accepted_price_huf   INTEGER,
    pickup_window_start  TIMESTAMPTZ,
    pickup_window_end    TIMESTAMPTZ,
    status               job_status NOT NULL DEFAULT 'pending',
    -- 6 számjegyű átvételi kód: csak a feladó látja, az átvevő mondja meg
    -- a sofőrnek az átadáskor, ezzel zárul le a fuvar (a GPS már csak log)
    delivery_code        VARCHAR(6),
    -- AI ellenőrzés a leíráshoz
    ai_description_ok    BOOLEAN,
    ai_description_notes TEXT,
    created_at           TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at           TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    delivered_at         TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_jobs_status     ON jobs(status);
CREATE INDEX IF NOT EXISTS idx_jobs_shipper    ON jobs(shipper_id);
CREATE INDEX IF NOT EXISTS idx_jobs_carrier    ON jobs(carrier_id);
CREATE INDEX IF NOT EXISTS idx_jobs_pickup_geo ON jobs(pickup_lat, pickup_lng);

-- ---------- Licitek (Bids) --------------------------------------------

CREATE TABLE IF NOT EXISTS bids (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    job_id      UUID NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
    carrier_id  UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    amount_huf  INTEGER NOT NULL CHECK (amount_huf > 0),
    message     TEXT,
    eta_minutes INTEGER,
    status      bid_status NOT NULL DEFAULT 'pending',
    created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (job_id, carrier_id)
);

CREATE INDEX IF NOT EXISTS idx_bids_job     ON bids(job_id);
CREATE INDEX IF NOT EXISTS idx_bids_carrier ON bids(carrier_id);

-- ---------- Fotók (Proof of Delivery 2.0) -----------------------------

CREATE TABLE IF NOT EXISTS photos (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    job_id      UUID NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
    uploader_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    kind        photo_kind NOT NULL,
    url         TEXT NOT NULL,
    -- GPS metaadat a felvétel pillanatában
    gps_lat     DOUBLE PRECISION,
    gps_lng     DOUBLE PRECISION,
    gps_accuracy_m NUMERIC(8,2),
    taken_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    -- AI elemzés eredménye (Gemini)
    ai_has_cargo    BOOLEAN,
    ai_confidence   NUMERIC(4,3),
    ai_raw_response JSONB,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_photos_job  ON photos(job_id);
CREATE INDEX IF NOT EXISTS idx_photos_kind ON photos(kind);

-- ---------- Értékelések (kétirányú) -----------------------------------

CREATE TABLE IF NOT EXISTS reviews (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    job_id      UUID NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
    reviewer_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    reviewee_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    rating      SMALLINT NOT NULL CHECK (rating BETWEEN 1 AND 5),
    comment     TEXT,
    photo_url   TEXT,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (job_id, reviewer_id, reviewee_id)
);

-- ---------- Escrow tranzakciók (letét) --------------------------------

CREATE TABLE IF NOT EXISTS escrow_transactions (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    job_id              UUID NOT NULL UNIQUE REFERENCES jobs(id) ON DELETE CASCADE,
    amount_huf          INTEGER NOT NULL CHECK (amount_huf > 0),
    status              escrow_status NOT NULL DEFAULT 'held',
    -- Barion Bridge mezők
    barion_payment_id   TEXT,
    barion_gateway_url  TEXT,
    carrier_share_huf   INTEGER,    -- 90 % a fuvardíjból
    platform_share_huf  INTEGER,    -- 10 % jutalék
    held_at             TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    released_at         TIMESTAMPTZ,
    refunded_at         TIMESTAMPTZ,
    notes               TEXT
);

-- ---------- Élő követés pozíció-loggal --------------------------------

CREATE TABLE IF NOT EXISTS location_pings (
    id         BIGSERIAL PRIMARY KEY,
    job_id     UUID NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
    carrier_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    lat        DOUBLE PRECISION NOT NULL,
    lng        DOUBLE PRECISION NOT NULL,
    speed_kmh  NUMERIC(6,2),
    recorded_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_pings_job_time ON location_pings(job_id, recorded_at DESC);

-- ---------- Sofőri útvonal-hirdetések ---------------------------------

DO $$ BEGIN
    CREATE TYPE carrier_route_status AS ENUM (
        'draft', 'open', 'full', 'in_progress', 'completed', 'cancelled'
    );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
    CREATE TYPE route_booking_status AS ENUM (
        'pending', 'confirmed', 'rejected', 'in_progress', 'delivered', 'cancelled', 'disputed'
    );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
    CREATE TYPE package_size_id AS ENUM ('S', 'M', 'L', 'XL');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE TABLE IF NOT EXISTS carrier_routes (
    id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    carrier_id         UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    title              TEXT NOT NULL,
    description        TEXT,
    departure_at       TIMESTAMPTZ NOT NULL,
    waypoints          JSONB NOT NULL DEFAULT '[]'::jsonb,
    vehicle_description TEXT,
    is_template        BOOLEAN NOT NULL DEFAULT FALSE,
    template_source_id UUID REFERENCES carrier_routes(id) ON DELETE SET NULL,
    status             carrier_route_status NOT NULL DEFAULT 'draft',
    created_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at         TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_carrier_routes_carrier ON carrier_routes(carrier_id);
CREATE INDEX IF NOT EXISTS idx_carrier_routes_status  ON carrier_routes(status);
CREATE INDEX IF NOT EXISTS idx_carrier_routes_depart  ON carrier_routes(departure_at);
CREATE INDEX IF NOT EXISTS idx_carrier_routes_waypoints ON carrier_routes USING GIN (waypoints);

CREATE TABLE IF NOT EXISTS carrier_route_prices (
    route_id  UUID NOT NULL REFERENCES carrier_routes(id) ON DELETE CASCADE,
    size      package_size_id NOT NULL,
    price_huf INTEGER NOT NULL CHECK (price_huf > 0),
    PRIMARY KEY (route_id, size)
);

CREATE TABLE IF NOT EXISTS route_bookings (
    id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    route_id          UUID NOT NULL REFERENCES carrier_routes(id) ON DELETE CASCADE,
    shipper_id        UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    package_size      package_size_id NOT NULL,
    length_cm         INTEGER NOT NULL,
    width_cm          INTEGER NOT NULL,
    height_cm         INTEGER NOT NULL,
    weight_kg         NUMERIC(8,2) NOT NULL,
    pickup_address    TEXT NOT NULL,
    pickup_lat        DOUBLE PRECISION NOT NULL,
    pickup_lng        DOUBLE PRECISION NOT NULL,
    dropoff_address   TEXT NOT NULL,
    dropoff_lat       DOUBLE PRECISION NOT NULL,
    dropoff_lng       DOUBLE PRECISION NOT NULL,
    price_huf         INTEGER NOT NULL CHECK (price_huf > 0),
    delivery_code     VARCHAR(6),
    status            route_booking_status NOT NULL DEFAULT 'pending',
    notes             TEXT,
    created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    confirmed_at      TIMESTAMPTZ,
    delivered_at      TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_bookings_route   ON route_bookings(route_id);
CREATE INDEX IF NOT EXISTS idx_bookings_shipper ON route_bookings(shipper_id);
CREATE INDEX IF NOT EXISTS idx_bookings_status  ON route_bookings(status);

-- ---------- Értesítések -----------------------------------------------

CREATE TABLE IF NOT EXISTS notifications (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id     UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    type        TEXT NOT NULL,
    title       TEXT NOT NULL,
    body        TEXT,
    link        TEXT,
    read_at     TIMESTAMPTZ,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_notifications_user_created ON notifications(user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_notifications_user_unread ON notifications(user_id) WHERE read_at IS NULL;
