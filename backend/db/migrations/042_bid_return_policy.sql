-- =====================================================================
--  042_bid_return_policy.sql — Sikertelen kézbesítés: visszaszállítási
--  nyilatkozat a licithez.
--
--  A sofőr a licit leadásakor nyilatkozik: ha a címzett NEM veszi át a
--  csomagot, vállalja-e, hogy 5 munkanapon belül visszajuttatja a
--  feladóhoz, és ha igen, milyen feltétellel.
--    - included  : "Igen, benne van az ajánlatomban" (nincs extra díj)
--    - extra_fee : "Igen, külön díj ellenében" (return_fee_huf a díj)
--    - no        : "Nem"
--
--  A feladó a licit-soron jelvényként látja → összehasonlíthatja a
--  sofőröket a visszaszállítási hajlandóság szerint.
-- =====================================================================

ALTER TABLE bids ADD COLUMN IF NOT EXISTS return_policy TEXT
  CHECK (return_policy IN ('included', 'extra_fee', 'no'));

ALTER TABLE bids ADD COLUMN IF NOT EXISTS return_fee_huf INTEGER;
