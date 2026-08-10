-- 066 — Halott PII-séma eltávolítása
--
-- A séma-alapú audit-lencse találata: van a rendszerben öt olyan oszlop, ami
-- SZEMÉLYES ADATOT tárolna, de a teljes kódbázisban egyetlen ÉLŐ út sem ír
-- bele, és egyetlen retenciós kör sem nézi. Vagyis: ha valaha bekerül adat
-- (egy jövőbeli feature-nél a séma „meglévőnek" látszik), az határidő nélkül
-- ott marad, és a fiók törlése sem éri el.
--
-- A legrosszabb köztük a `kyc_documents.doc_number`: az a NYERS okmányszám —
-- pontosan az, amit sehol nem szabad tárolnunk, és amit az élő úton
-- kizárólag HMAC-lenyomatként őrzünk (064-es migráció). Ráadásul az
-- admin-panel meg is jelenítette volna a `full_name_on_doc`-kal együtt
-- (a lekérdezés `SELECT k.*`-gal megy).
--
-- ⚠️ ELLENŐRIZVE A PRODON A TÖRLÉS ELŐTT — mind az öt oszlopban 0 kitöltött
-- sor van, tehát adat nem vész el:
--     kyc_documents.doc_number          → 0
--     kyc_documents.full_name_on_doc    → 0
--     kyc_documents.expiry_date         → 0
--     users.license_doc_url             → 0
--     users.carrier_insurance_url       → 0
--
-- Az egyetlen író (services/kyc.js `submitLicenseDocument`) sehonnan nem
-- hívott, a rá épülő jogosítvány-lejárati értesítő (`checkExpiredLicenses`)
-- pedig nincs ütemezve — mindkettő a JOGOSÍTVÁNY-KÖVETELMÉNY 2026-07-07-i
-- megszüntetése óta halott kód. Velük együtt törlődnek.
-- (Ugyanaz a döntés, mint az 052-nél a `favorite_drivers`-nél és a 065-nél a
-- `weekly_challenges`-nél.)

ALTER TABLE kyc_documents DROP COLUMN IF EXISTS doc_number;
ALTER TABLE kyc_documents DROP COLUMN IF EXISTS full_name_on_doc;
ALTER TABLE kyc_documents DROP COLUMN IF EXISTS expiry_date;

ALTER TABLE users DROP COLUMN IF EXISTS license_doc_url;
ALTER TABLE users DROP COLUMN IF EXISTS carrier_insurance_url;
