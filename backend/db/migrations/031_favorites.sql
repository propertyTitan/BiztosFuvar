-- =====================================================================
--  031_favorites.sql — Kedvenc sofőrök
--
--  A feladó megjelölheti kedvencnek a sofőrt. Legközelebb ha fuvart
--  ad fel, a kedvenc sofőr ELSŐ push értesítést kap (prioritásos).
-- =====================================================================

CREATE TABLE IF NOT EXISTS favorite_drivers (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id     UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    driver_id   UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (user_id, driver_id)
);

CREATE INDEX IF NOT EXISTS idx_favorites_user   ON favorite_drivers(user_id);
CREATE INDEX IF NOT EXISTS idx_favorites_driver ON favorite_drivers(driver_id);
