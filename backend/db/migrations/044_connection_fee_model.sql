-- 044: Készpénzes modell — kapcsolatfelvételi díj (2026-07-03 üzleti döntés)
--
-- A platform mostantól NEM a teljes fuvardíjat kezeli (escrow), hanem egy
-- sávos, bevezető árú KAPCSOLATFELVÉTELI DÍJAT szed a feladótól a licit
-- elfogadásakor. A fuvardíjat a feladó KÉSZPÉNZBEN fizeti a sofőrnek.
--
--  - connection_fee_huf: a fuvarhoz kiszámolt díj (bruttó Ft) — a fizetéskor
--    rögzül, később nem változik, akkor sem, ha újraválasztásnál más árú
--    licitet fogad el a feladó (a díj a fuvarra/termékre szól, egyszeri).
--  - fee_consent_at: a 45/2014. Korm. r. 29. § (1) a) szerinti kifejezett
--    beleegyezés időpontja (azonnali teljesítés kérése + elállási jog
--    elvesztésének tudomásulvétele). Enélkül nincs fizetés.
--  - reopened_count: hányszor lett a fuvar díjmentesen újranyitva
--    (sofőr-lemondás / sofőr-csere után) — audit + visszaélés-figyelés.

ALTER TABLE jobs ADD COLUMN IF NOT EXISTS connection_fee_huf INTEGER;
ALTER TABLE jobs ADD COLUMN IF NOT EXISTS fee_consent_at TIMESTAMPTZ;
ALTER TABLE jobs ADD COLUMN IF NOT EXISTS reopened_count INTEGER NOT NULL DEFAULT 0;

-- Útvonal-foglalások: ugyanaz a modell (díj a foglaláskor, fuvardíj kápé)
ALTER TABLE route_bookings ADD COLUMN IF NOT EXISTS connection_fee_huf INTEGER;
ALTER TABLE route_bookings ADD COLUMN IF NOT EXISTS fee_consent_at TIMESTAMPTZ;
