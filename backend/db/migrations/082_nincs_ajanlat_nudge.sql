-- Teljes audit B3 (2026-09-11): „nincs ajánlat" nudge könyvelése.
-- A 24 órája ajánlat nélkül álló nyitott fuvar feladója EGYSZER kap tippeket
-- (ár, időablak, leírás) — ez az időbélyeg a dupla küldést zárja ki.
ALTER TABLE jobs ADD COLUMN IF NOT EXISTS no_offer_nudge_at TIMESTAMPTZ;
