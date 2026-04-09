-- =====================================================================
--  Sofőri útvonal-hirdetések (carrier_routes) + foglalások (route_bookings)
--
--  A második fuvartípus: a sofőr hirdeti az útvonalát (pl. "holnap megyek
--  Szegedről Budapestre, érintem Kecskemétet és Kiskunfélegyházát"), és a
--  feladók helyet foglalnak rajta fix kategóriás árakon.
--
--  A sofőr:
--   - útvonalat hirdet (cím-tagek városokkal + koordinátákkal)
--   - a 4 méretkategóriából aktiválhatja azokat, amelyeket szállítana
--   - minden aktív kategóriához egyéni Ft árat ad
--   - el tudja menteni az útvonalat sablonként és újra aktiválni
--
--  A feladó:
--   - böngészi a nyitott útvonalakat
--   - a csomagja alapján automatikus méret-besorolás
--   - foglalás → a sofőrnek megerősítés kell → Barion escrow
--   - onnantól a meglévő workflow: pickup/dropoff fotó, kód, kifizetés
-- =====================================================================

DO $$ BEGIN
    CREATE TYPE carrier_route_status AS ENUM (
        'draft',       -- még nincs publikálva, csak mentve
        'open',        -- publikálva, foglalható
        'full',        -- még publikálva, de nem fogad új foglalást
        'in_progress', -- a sofőr elindult, zajlik az út
        'completed',   -- minden foglalás teljesült
        'cancelled'    -- törölt útvonal
    );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
    CREATE TYPE route_booking_status AS ENUM (
        'pending',     -- foglalás leadva, sofőri megerősítésre vár
        'confirmed',   -- sofőr elfogadta, escrow él
        'rejected',    -- sofőr elutasította
        'in_progress', -- pickup megtörtént
        'delivered',   -- lerakva, kóddal lezárva
        'cancelled',   -- törölve
        'disputed'     -- vitatott
    );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
    CREATE TYPE package_size_id AS ENUM ('S', 'M', 'L', 'XL');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ---------- Sofőri útvonalak -----------------------------------------

CREATE TABLE IF NOT EXISTS carrier_routes (
    id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    carrier_id         UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    title              TEXT NOT NULL,
    description        TEXT,
    -- Indulás időpontja (fix, de a sofőr jelezhet rugalmasságot a description-ben)
    departure_at       TIMESTAMPTZ NOT NULL,
    -- Útvonal megállói rendezett tömbben. Minden elem:
    --   { "name": "Szeged", "formatted_address": "...", "lat": ..., "lng": ..., "order": 0 }
    -- A 0. index a kiindulópont, az utolsó a célállomás, köztük megállók.
    waypoints          JSONB NOT NULL DEFAULT '[]'::jsonb,
    -- Jármű leírás, hogy a feladó lássa, mivel megy a sofőr
    vehicle_description TEXT,
    -- Egy sablon-e: ha igen, a sofőr újra tudja aktiválni egy későbbi útra
    is_template        BOOLEAN NOT NULL DEFAULT FALSE,
    -- Ha sablonból lett publikálva, innen másolódik
    template_source_id UUID REFERENCES carrier_routes(id) ON DELETE SET NULL,
    status             carrier_route_status NOT NULL DEFAULT 'draft',
    created_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at         TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_carrier_routes_carrier ON carrier_routes(carrier_id);
CREATE INDEX IF NOT EXISTS idx_carrier_routes_status  ON carrier_routes(status);
CREATE INDEX IF NOT EXISTS idx_carrier_routes_depart  ON carrier_routes(departure_at);
-- GIN index a waypoints-on, hogy a feladói szűrés gyors legyen
-- (pl. "van-e olyan útvonal, aminek a waypoint-jai közt szerepel Kecskemét")
CREATE INDEX IF NOT EXISTS idx_carrier_routes_waypoints ON carrier_routes USING GIN (waypoints);

-- ---------- Egy útvonalhoz tartozó méret-árak ------------------------
--
-- Egy soronként egy aktivált méret-kategória + a sofőr által megadott ár.
-- Ha egy (route, size) páros nincs ebben a táblában → a sofőr nem aktiválta
-- azt a kategóriát, a feladó nem fogja látni.

CREATE TABLE IF NOT EXISTS carrier_route_prices (
    route_id     UUID NOT NULL REFERENCES carrier_routes(id) ON DELETE CASCADE,
    size         package_size_id NOT NULL,
    price_huf    INTEGER NOT NULL CHECK (price_huf > 0),
    PRIMARY KEY (route_id, size)
);

-- ---------- Feladói foglalások ---------------------------------------

CREATE TABLE IF NOT EXISTS route_bookings (
    id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    route_id          UUID NOT NULL REFERENCES carrier_routes(id) ON DELETE CASCADE,
    shipper_id        UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    -- Csomag adatai (ugyanúgy, mint a jobs táblában)
    package_size      package_size_id NOT NULL,
    length_cm         INTEGER NOT NULL,
    width_cm          INTEGER NOT NULL,
    height_cm         INTEGER NOT NULL,
    weight_kg         NUMERIC(8,2) NOT NULL,
    -- Pickup / dropoff a foglalás konkrét címei (nem az útvonal pontjai,
    -- hanem ahol a feladó akarja felvetetni / leadni)
    pickup_address    TEXT NOT NULL,
    pickup_lat        DOUBLE PRECISION NOT NULL,
    pickup_lng        DOUBLE PRECISION NOT NULL,
    dropoff_address   TEXT NOT NULL,
    dropoff_lat       DOUBLE PRECISION NOT NULL,
    dropoff_lng       DOUBLE PRECISION NOT NULL,
    -- Ár + kapcsolódó kódok / állapot
    price_huf         INTEGER NOT NULL CHECK (price_huf > 0),
    delivery_code     VARCHAR(6), -- 6 jegyű átvételi kód, ugyanaz a logika, mint a jobs táblában
    status            route_booking_status NOT NULL DEFAULT 'pending',
    notes             TEXT,        -- feladó megjegyzése
    created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    confirmed_at      TIMESTAMPTZ,
    delivered_at      TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_bookings_route   ON route_bookings(route_id);
CREATE INDEX IF NOT EXISTS idx_bookings_shipper ON route_bookings(shipper_id);
CREATE INDEX IF NOT EXISTS idx_bookings_status  ON route_bookings(status);
