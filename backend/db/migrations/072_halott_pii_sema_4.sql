-- 072 — Halott séma, negyedik kör
--
-- A 066/070/071 ugyanezt az osztályt célozta, de KÉZI listával — ezért a
-- következő független mérés megint talált újat. Ami most megy (mind 0
-- kód-hivatkozás, szó-határos kereséssel a backend/src + web/src + web/app
-- felett ellenőrizve):
--
--   users.kyc_status        → ELAVULT HITELESÍTÉSI ÁLLAPOT. A 027-es migráció
--                             óta az identity_kyc_status / driver_kyc_status
--                             váltotta fel. A régi értékek ('verified')
--                             bennmaradtak a korai fiókokon, és SENKI nem
--                             tartja karban: egy személy hitelesítési
--                             állapotát állítja, ami már nem igaz semmire.
--   users.kyc_verified_at   → ugyanaz, időbélyeggel
--   jobs.urgency_level      → 016-os termék-ötlet, sosem használt
--   carrier_routes.is_international / available_capacity_kg /
--     available_capacity_m3 / return_trip → ugyanaz a 016-os kör
--   invoices.external_id    → az external_system él, ez nem
--
-- ⚠️ A LEGFONTOSABB a `users.kyc_status`: adat-minimalizálási szempontból az
-- elavult hitelesítési állapot a legrosszabb fajta maradvány — személyre
-- vonatkozik, „meglévőnek" látszik a sémában, és egy jövőbeli lekérdezés
-- némán a RÉGI (hibás) értéket olvasná ki. NOT NULL DEFAULT 'none' volt,
-- tehát az eldobása semmilyen írási utat nem tör el.
--
-- ⚠️ NEM MEGY (tudatos döntés): `kyc_doc_history.first_seen_at`. A purge a
-- `last_seen_at`-ra fut, tehát a first_seen_at valóban nem hajt semmit — de
-- ez az egyetlen nyom arról, MIÓTA tartunk egy okmány-lenyomatot, ami a
-- csalásvédelmi jogos érdek arányosságának igazolásához kell (a lenyomat
-- 5 éves megőrzését az érdekmérlegelési teszt II. pontja erre alapozza).

ALTER TABLE users          DROP COLUMN IF EXISTS kyc_status;
ALTER TABLE users          DROP COLUMN IF EXISTS kyc_verified_at;
ALTER TABLE jobs           DROP COLUMN IF EXISTS urgency_level;
ALTER TABLE carrier_routes DROP COLUMN IF EXISTS is_international;
ALTER TABLE carrier_routes DROP COLUMN IF EXISTS available_capacity_kg;
ALTER TABLE carrier_routes DROP COLUMN IF EXISTS available_capacity_m3;
ALTER TABLE carrier_routes DROP COLUMN IF EXISTS return_trip;
ALTER TABLE invoices       DROP COLUMN IF EXISTS external_id;
