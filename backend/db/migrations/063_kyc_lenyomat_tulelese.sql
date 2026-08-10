-- 063 — Az okmány-lenyomat túléli a fiók törlését (5 évig)
--
-- USER-DÖNTÉS (2026-08-10): „a fiók törlésével ne lehessen újra regisztrálni
-- kvázi újként".
--
-- MIÉRT KELL: az adatkezelési tájékoztató, a 30. cikk nyilvántartás ÉS egy
-- teljes érdekmérlegelési teszt (II.) is azt állítja, hogy az okmányszám
-- lenyomatát a fiók megszűnése után 5 évig megőrizzük — csalásvédelmi
-- célból, hogy „egy okmány = egy fiók" legyen. A séma viszont ezt cáfolta:
--
--     kyc_documents.user_id → users ON DELETE CASCADE
--
-- vagyis a fiók törlésekor a lenyomat AZONNAL eltűnt, és a duplikátum-
-- ellenőrzés csak élő sorokat néz. A kitiltott felhasználó tehát törölte a
-- fiókját, és ugyanazzal a személyivel visszajött — tiszta lappal.
-- Egy formális dokumentum indokolt egy nem létező adatkezelést.
--
-- A MEGOLDÁS: a lenyomat külön táblába kerül, ami NEM kaszkádol a userrel.
-- Csak egy SHA-256 lenyomatot tárol (az okmányszámot magát sosem) és
-- időbélyegeket — a személyhez nem köthető vissza, csak összevetni lehet
-- vele egy ÚJ feltöltést.
--
-- ⚠️ SZÁNDÉKOSAN NEM KEMÉNY TILTÁS: a visszatérő felhasználó nem esik ki
-- örökre — a KYC-je EMBERI ellenőrzésre kerül (pending), és az admin látja,
-- hogy ezt az okmányt egy korábban törölt fiók használta. A valódi cél nem
-- a kizárás, hanem hogy ne lehessen ELŐZMÉNY NÉLKÜLI, „friss" fiókként
-- visszatérni. (Egy vak tiltás a jóhiszemű visszatérőt is kizárná, és a
-- GDPR 22. cikk szerinti automatizált döntés lenne emberi felülvizsgálat
-- nélkül.)

CREATE TABLE IF NOT EXISTS kyc_doc_history (
    doc_number_hash   TEXT PRIMARY KEY,
    first_seen_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    last_seen_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    -- Hányszor szűnt meg olyan fiók, ami ezt az okmányt használta.
    -- 0 = az okmány élő fiókhoz tartozik (a duplikátum-ellenőrzést a
    -- kyc_documents tábla végzi); >0 = volt már törlés → emberi ellenőrzés.
    deleted_account_count INT NOT NULL DEFAULT 0,
    -- A legutóbbi megszűnés oka (self/admin) — az admin ebből látja, hogy
    -- kitiltás elől menekülés-e. Szabad szöveg, nem tartalmaz személyes adatot.
    last_deletion_reason  TEXT
);

-- A napi retenciós kör ezen keresi az elévült lenyomatokat (5 év).
CREATE INDEX IF NOT EXISTS idx_kyc_doc_history_last_seen
    ON kyc_doc_history (last_seen_at);

-- A MEGLÉVŐ, élő okmányok lenyomatai bekerülnek — enélkül a mai
-- felhasználók törlés utáni visszatérése észrevétlen maradna.
INSERT INTO kyc_doc_history (doc_number_hash, first_seen_at, last_seen_at)
SELECT DISTINCT doc_number_hash, MIN(created_at), MAX(created_at)
  FROM kyc_documents
 WHERE doc_number_hash IS NOT NULL
 GROUP BY doc_number_hash
ON CONFLICT (doc_number_hash) DO NOTHING;
