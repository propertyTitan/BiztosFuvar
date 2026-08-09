-- 061 — A törölt fiókok lenyomatának rendezése
--
-- HIBA (2026-08-09, adatvédelmi audit 3. kör): a `deleted_accounts.email_hash`
-- egy SÓZATLAN SHA-256 lenyomat volt az e-mail-címről, örökre megőrizve —
-- miközben a teljes kódbázisban EGYETLEN hivatkozás van a táblára: maga az
-- INSERT. Vagyis:
--
--   (1) a megjelölt cél („visszaélés-védelem") nem valósul meg, mert nincs
--       kód, ami valaha összevetné egy új regisztrációval;
--   (2) az e-mail-címek tere felsorolható, ezért a sózatlan SHA-256 egy
--       jelöltlistával visszafejthető → ez PSZEUDONIMIZÁLT, nem anonim adat;
--   (3) semmilyen retenció nem vonatkozott rá.
--
-- Így épp attól őriztünk határidő nélkül visszaazonosítható adatot, aki a
-- törlési jogát gyakorolta (GDPR 17. cikk).
--
-- MEGOLDÁS: a lenyomat mostantól HMAC-elt (szerver-oldali titokkal, ami nincs
-- a DB-ben — így egy DB-szivárgásból önmagában nem visszafejthető), és 5 év
-- után a napi retenciós kör törli a sort. A tábla célja ezzel őszintén az,
-- ami: audit-nyom arról, hogy egy fiók mikor és milyen okból szűnt meg.

-- Az oszlop eddig NOT NULL volt — a régi, visszafejthető lenyomatok
-- eltávolításához fel kell oldani.
ALTER TABLE deleted_accounts ALTER COLUMN email_hash DROP NOT NULL;

-- A MEGLÉVŐ, sózatlan lenyomatok visszafejthetők — ezért töröljük őket.
-- A törlés TÉNYE (mikor, milyen okból) megmarad, ami az audit valódi célja.
UPDATE deleted_accounts SET email_hash = NULL WHERE email_hash IS NOT NULL;

-- Jelöljük, melyik sor készült az új (HMAC-elt) eljárással.
ALTER TABLE deleted_accounts
    ADD COLUMN IF NOT EXISTS hash_algo TEXT;

-- A tábla időbélyege `deleted_at` (033-as migráció), nem `created_at`.
CREATE INDEX IF NOT EXISTS idx_deleted_accounts_deleted_at
    ON deleted_accounts (deleted_at);
