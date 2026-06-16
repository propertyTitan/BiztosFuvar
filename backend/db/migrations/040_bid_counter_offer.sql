-- =====================================================================
--  040_bid_counter_offer.sql — Ellenajánlat a licitekre (Vinted-stílus alku).
--
--  A feladó és a sofőr is tehet ellenajánlatot a licit összegére. A
--  legutóbbi ellenajánlat összegét + ki tette + mikor tároljuk a biden.
--  A megállapodás akkor zárul, ha a másik fél elfogadja a legutóbbi ajánlatot.
-- =====================================================================

ALTER TABLE bids ADD COLUMN IF NOT EXISTS counter_amount_huf INTEGER;
ALTER TABLE bids ADD COLUMN IF NOT EXISTS counter_by TEXT
  CHECK (counter_by IN ('shipper', 'carrier'));
ALTER TABLE bids ADD COLUMN IF NOT EXISTS counter_at TIMESTAMPTZ;
