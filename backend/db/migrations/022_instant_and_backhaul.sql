-- =====================================================================
--  022_instant_and_backhaul.sql
--
--  Két új termék-funkció a GoFuvarnak:
--
--  1) AZONNALI FUVAR ("UberFuvar" mód) — a feladó fix áron adja fel,
--     nincs licitálás. A rendszer push-ol minden közeli sofőrnek, és az
--     ELSŐ elfogadás nyer (atomi állapotátmenet: bidding → accepted).
--
--     Új mezők a `jobs` táblán:
--       - is_instant BOOLEAN         : instant mód kapcsoló
--       - instant_radius_km INTEGER  : kit értesítsünk (alap 20 km)
--       - instant_expires_at TIMESTAMP: meddig él a felhívás (alap +30 perc)
--       - instant_accepted_at TIMESTAMP: mikor fogadta el a nyertes sofőr
--
--  2) VISSZAFUVAR-MATCHING (backhaul) — nem igényel új mezőt, csak index-et.
--     A service a meglévő koordinátákra épít: egy sofőrnek, aki már
--     vállalt egy A→B fuvart, automatikusan ajánljuk a B közeléből
--     induló, A közelébe tartó fuvarokat (hogy ne üresen jöjjön vissza).
--     A `idx_jobs_dropoff_geo` index a B→A query-hez kell a
--     `pickup_lat/lng @ box(dropoff_lat/lng)` szűréshez.
-- =====================================================================

ALTER TABLE jobs
    ADD COLUMN IF NOT EXISTS is_instant           BOOLEAN     NOT NULL DEFAULT FALSE,
    ADD COLUMN IF NOT EXISTS instant_radius_km    INTEGER,
    ADD COLUMN IF NOT EXISTS instant_expires_at   TIMESTAMPTZ,
    ADD COLUMN IF NOT EXISTS instant_accepted_at  TIMESTAMPTZ;

COMMENT ON COLUMN jobs.is_instant IS
  'Ha TRUE: fix áras, első-elfogadó-nyer mód. A suggested_price_huf a végleges ár.';
COMMENT ON COLUMN jobs.instant_radius_km IS
  'Push-értesítés körzete km-ben (a pickup körül). Alapértelmezés: 20.';
COMMENT ON COLUMN jobs.instant_expires_at IS
  'Meddig vállalható. Lejárat után a feladó automatikusan lemondhatja / átalakíthatja licites fuvarrá.';

-- Backhaul query indexek: gyorsítja a "dropoff közelében van" lekérdezést.
CREATE INDEX IF NOT EXISTS idx_jobs_dropoff_geo ON jobs(dropoff_lat, dropoff_lng);

-- Instant fuvarok gyors szűréséhez a sofőri fuvarok oldalon
CREATE INDEX IF NOT EXISTS idx_jobs_is_instant
  ON jobs(is_instant, status)
  WHERE is_instant = TRUE;
