-- =====================================================================
--  037_carrier_alerts.sql — Sofőr útvonal-figyelők (lane alerts)
--
--  A sofőr beállíthat "figyelőket": felvételi környék (+ opcionális
--  célterület) egy sugárral. Amikor új licitálható fuvar jön létre és
--  illeszkedik, a sofőr EMAIL + in-app értesítést kap (SMS nincs).
-- =====================================================================

CREATE TABLE IF NOT EXISTS carrier_alerts (
    id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    carrier_id    UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    label         TEXT,                                  -- pl. "Budapest → Szeged"
    from_lat      DOUBLE PRECISION NOT NULL,
    from_lng      DOUBLE PRECISION NOT NULL,
    from_label    TEXT,                                  -- felvételi környék neve
    to_lat        DOUBLE PRECISION,                      -- opcionális célterület
    to_lng        DOUBLE PRECISION,
    to_label      TEXT,
    radius_km     INTEGER NOT NULL DEFAULT 25 CHECK (radius_km BETWEEN 1 AND 300),
    min_price_huf INTEGER,                               -- opcionális szűrő
    max_weight_kg INTEGER,                               -- opcionális szűrő
    active        BOOLEAN NOT NULL DEFAULT TRUE,
    created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_carrier_alerts_carrier ON carrier_alerts(carrier_id);
CREATE INDEX IF NOT EXISTS idx_carrier_alerts_active  ON carrier_alerts(active) WHERE active;
