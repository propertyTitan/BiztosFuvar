-- =====================================================================
--  024_ride_along.sql — "Útba esik" mód
--
--  A sofőr jelölheti az útvonalát "ride-along"-ként: már amúgy is megy
--  A→B, szívesen felvesz kis csomagokat az útja mentén olcsóbban.
--  Ez az ár-előny, amit sem a posta, sem a GLS nem tud megverni.
-- =====================================================================

ALTER TABLE carrier_routes
    ADD COLUMN IF NOT EXISTS is_ride_along BOOLEAN NOT NULL DEFAULT FALSE;

COMMENT ON COLUMN carrier_routes.is_ride_along IS
  'Ha TRUE: a sofőr amúgy is megy erre, olcsóbban vállalja a csomagokat.';

CREATE INDEX IF NOT EXISTS idx_routes_ride_along
  ON carrier_routes(is_ride_along, status)
  WHERE is_ride_along = TRUE;
