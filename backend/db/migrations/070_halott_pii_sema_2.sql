-- 070 — Halott séma, második kör
--
-- A 066-os migráció öt halott PII-oszlopot vitt el; a következő független
-- mérés még ötöt talált. Ugyanaz az indok: a nem használt séma NEM semleges —
-- ha egy jövőbeli feature „meglévőnek" látja és írni kezdi, az adat határidő
-- nélkül ott marad, mert egyetlen retenciós kör és egyetlen fájl-gyűjtő sem
-- tud róla.
--
-- ⚠️ A LEGKOCKÁZATOSABB a `reviews.photo_url`: egy FOTÓ-URL oszlop. Ha egyszer
-- ír bele valami, sem a `utils/userFiles.js` gyűjtői, sem a `retention.js` nem
-- néznének rá → azonnali, végleges árva-gyár az R2-ben.
--
-- MIND A PRODON ELLENŐRIZVE A TÖRLÉS ELŐTT (0 kitöltött sor):
--   users.license_expiry   → 0   (a jogosítvány-követelmény 2026-07-07 óta nincs)
--   users.is_verified      → 0   (a `is_verified_carrier` MÁS oszlop, az ÉL)
--   users.verified_at      → 0
--   reviews.photo_url      → 0
--
-- ⚠️ A `users.kyc_status`-t SZÁNDÉKOSAN NEM BÁNTJUK. Az audit halott sémaként
-- jelezte, és tényleg nincs rá egyetlen kód-hivatkozás sem (az élő mezők az
-- `identity_kyc_status` és a `driver_kyc_status`) — DE: (a) NOT NULL, tehát
-- kiüríteni csak a megszorítás feloldásával lehetne; (b) 18 kitöltött sora
-- van; (c) az értéke egy STÁTUSZ ('pending'/'verified'), nem személyes adat a
-- szó érdemi értelmében, és az `identity_kyc_status` úgyis duplikálja.
-- A séma-megszorítás átírása egy nem-PII, nem használt státusz-mezőért
-- aránytalan kockázat. A retenciós manifestben a `users` sora fedi; ha valaha
-- tényleg zavar, önálló, tudatos döntés lehet eldobni.

ALTER TABLE users   DROP COLUMN IF EXISTS license_expiry;
ALTER TABLE users   DROP COLUMN IF EXISTS is_verified;
ALTER TABLE users   DROP COLUMN IF EXISTS verified_at;
ALTER TABLE reviews DROP COLUMN IF EXISTS photo_url;
