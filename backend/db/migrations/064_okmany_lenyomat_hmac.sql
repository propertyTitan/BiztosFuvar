-- 064 — Az okmányszám-lenyomat HMAC-ra váltása
--
-- HIBA (2026-08-10, két független audit-lencse): a `doc_number_hash` SÓZATLAN
-- SHA-256 volt, miközben a magyar személyi igazolvány számának értéktere
-- teljesen felsorolható (~10⁸ nagyságrend). Egy sózatlan hash ekkora téren
-- egy jelöltlistával percek alatt visszafejthető — vagyis PSZEUDONIMIZÁLT
-- adat, nem anonim.
--
-- ⚠️ AMIÉRT EZ KÜLÖNÖSEN KÍNOS: a 061-es migráció (egy nappal korábban) SZÓ
-- SZERINT LEÍRJA UGYANEZT AZ ÉRVELÉST az e-mail-lenyomatra, és emiatt vált
-- HMAC-ra. A 063-as migráció ezután vezette be ugyanazt a sózatlan SHA-256-ot
-- egy KISEBB értéktéren álló azonosítóra — és „a személyhez nem köthető
-- vissza"-ként dokumentálta. Három helyen (tájékoztató, DPIA, kód-komment)
-- állítottuk, hogy nem visszafejthető.
--
-- MEGOLDÁS: a lenyomat mostantól HMAC, szerver-oldali titokkal (a titok nincs
-- a DB-ben, így egy adatbázis-szivárgásból önmagában nem visszafejthető).
--
-- ⚠️ ÁTMENET: a nyers okmányszámot SOHA nem tároltuk, ezért a MEGLÉVŐ
-- lenyomatokat nem lehet újraszámolni. Ezért:
--   * a meglévő sorok `hash_algo = 'sha256-legacy'` jelölést kapnak;
--   * a duplikátum-ellenőrzés MINDKÉT alakra illeszt (a feltöltéskor a nyers
--     számból mindkettő kiszámolható), így a védelem nem gyengül;
--   * az új sorok HMAC-kal íródnak, és a legacy sorok a következő
--     feltöltéskor lecserélődnek.
-- A launch-kapu ellenőrzőlistára felkerül: a `hash_algo='sha256-legacy'`
-- sorok számát élesedés előtt le kell nullázni (a kevés érintett
-- újra-feltöltésével), különben a „nem visszafejthető" állítás rájuk nem igaz.

ALTER TABLE kyc_documents
    ADD COLUMN IF NOT EXISTS hash_algo TEXT;

ALTER TABLE kyc_doc_history
    ADD COLUMN IF NOT EXISTS hash_algo TEXT;

UPDATE kyc_documents
   SET hash_algo = 'sha256-legacy'
 WHERE doc_number_hash IS NOT NULL AND hash_algo IS NULL;

UPDATE kyc_doc_history
   SET hash_algo = 'sha256-legacy'
 WHERE hash_algo IS NULL;
