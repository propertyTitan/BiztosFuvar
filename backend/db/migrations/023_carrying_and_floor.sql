-- =====================================================================
--  023_carrying_and_floor.sql
--
--  Bepakolás / cipelés információ a fuvaron.
--
--  A feladó megadhatja, hogy a sofőrnek kell-e bepakolnia felvételkor
--  és/vagy felvinnie lerakodáskor a csomagot. Ha igen: emelet szám
--  (0 = földszint, 1-10) + van-e lift.
--
--  A sofőr ezek alapján dönt, hogy elvállalja-e: pl. sérült sofőr
--  egy 5. emeleti lépcsős bepakolást nem tud vállalni.
-- =====================================================================

ALTER TABLE jobs
    ADD COLUMN IF NOT EXISTS pickup_needs_carrying   BOOLEAN NOT NULL DEFAULT FALSE,
    ADD COLUMN IF NOT EXISTS pickup_floor             SMALLINT NOT NULL DEFAULT 0,
    ADD COLUMN IF NOT EXISTS pickup_has_elevator      BOOLEAN NOT NULL DEFAULT FALSE,
    ADD COLUMN IF NOT EXISTS dropoff_needs_carrying   BOOLEAN NOT NULL DEFAULT FALSE,
    ADD COLUMN IF NOT EXISTS dropoff_floor            SMALLINT NOT NULL DEFAULT 0,
    ADD COLUMN IF NOT EXISTS dropoff_has_elevator     BOOLEAN NOT NULL DEFAULT FALSE;

COMMENT ON COLUMN jobs.pickup_needs_carrying IS 'A sofőrnek kell-e bepakolnia a felvételi helyen?';
COMMENT ON COLUMN jobs.pickup_floor IS 'Emelet szám a felvételi helyen (0=földszint, 1-10)';
COMMENT ON COLUMN jobs.pickup_has_elevator IS 'Van-e lift a felvételi helyen?';
COMMENT ON COLUMN jobs.dropoff_needs_carrying IS 'A sofőrnek kell-e felvinnie a lerakodási helyen?';
COMMENT ON COLUMN jobs.dropoff_floor IS 'Emelet szám a lerakodási helyen (0=földszint, 1-10)';
COMMENT ON COLUMN jobs.dropoff_has_elevator IS 'Van-e lift a lerakodási helyen?';
