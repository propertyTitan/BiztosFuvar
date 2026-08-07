-- =====================================================================
--  053_vita_elotti_statusz.sql — a vitás állapot legyen visszafordítható
--
--  PROBLÉMA (2026-08-07, a teljes-út mátrix találata): a `disputed` állapot
--  EGYIRÁNYÚ UTCA volt. A vita megnyitása felülírta a fuvar státuszát
--  ('in_progress' → 'disputed'), a vita LEZÁRÁSA viszont nem állította
--  vissza semmire — a fuvar örökre 'disputed' maradt, akkor is, ha az admin
--  úgy döntött, hogy nincs teendő. Emiatt a vitás állapotot „befagyasztani"
--  sem lehetett (az véglegesen beragasztotta volna a fuvart), így vita alatt
--  olyan műveletek is nyitva maradtak, amiknek nem kellett volna.
--
--  MEGOLDÁS: a vita megnyitásakor eltesszük az AKKORI státuszt, és a vita
--  lezárásakor visszaállítjuk. Így a `disputed` egy átmeneti, visszafordítható
--  állapot lesz — és ettől kezdve biztonságosan szigoríthatók a vita alatti
--  műveletek is.
-- =====================================================================

ALTER TABLE jobs
  ADD COLUMN IF NOT EXISTS status_before_dispute job_status;

ALTER TABLE route_bookings
  ADD COLUMN IF NOT EXISTS status_before_dispute route_booking_status;

COMMENT ON COLUMN jobs.status_before_dispute IS
  'A vita megnyitásakor érvényes státusz. A vita lezárásakor ide állunk vissza, majd NULL-ra ürül.';
COMMENT ON COLUMN route_bookings.status_before_dispute IS
  'A vita megnyitásakor érvényes státusz. A vita lezárásakor ide állunk vissza, majd NULL-ra ürül.';
