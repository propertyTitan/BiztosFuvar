-- 074 — Halott séma, ötödik kör
--
-- ⚠️ ÖT KÖR UTÁN IS TALÁLT ÚJAT A FÜGGETLEN MÉRÉS. A 066/070/071/072 mind
-- KÉZI listával dolgozott, és mind talált olyat, amit az előző kihagyott.
-- Ez az EGYETLEN hibaosztály a rendszerben, amit nem őr véd, hanem éberség.
-- (A retenciós manifest minden TÁBLÁT bejár, de az OSZLOPOKAT nem.)
--
-- Ami most megy (mind 0 ÍRÁSI hivatkozás — a mezőket senki sem tölti ki):
--
--   kyc_documents.expiry_warned_30d / expiry_warned_7d
--       A jogosítvány-lejárati értesítő maradványa. A 2026-07-07-i döntés óta
--       (jogosítvány NEM kell, a személyi elég) a funkció halott.
--
--   users.service_categories
--       Csak az admin-lista SELECT-jében szerepelt, soha nem írtuk.
--
--   users.total_earnings
--       ⚠️ EZ A LEGZAVARÓBB: soha egyetlen kódút sem írta, tehát MINDIG 0
--       volt — mégis „összes kereset" néven jelent meg a szintrendszerben.
--       A kápés modellben eleve értelmezhetetlen: a fuvardíj 100%-a a
--       szállítóé, a platform nem is látja. A `total_deliveries` MARAD, azt
--       tényleg karbantartjuk.
--
-- A mezőket olvasó kód ELŐBB kikerült (admin.js, gamification.js) — a
-- migráció csak azután fut, hogy semmi nem hivatkozik rájuk.

ALTER TABLE kyc_documents DROP COLUMN IF EXISTS expiry_warned_30d;
ALTER TABLE kyc_documents DROP COLUMN IF EXISTS expiry_warned_7d;
ALTER TABLE users         DROP COLUMN IF EXISTS service_categories;
ALTER TABLE users         DROP COLUMN IF EXISTS total_earnings;
