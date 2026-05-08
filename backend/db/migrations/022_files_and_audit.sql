-- GoFuvar — egységes file-tábla, audit log, beleegyezések.
--
-- Cél: minden feltöltött fájl (KYC jogosítvány, fuvar-fotó, avatar) egyetlen
-- belső UUID-vel azonosítható, sose adunk publikus URL-t a kliensnek.
-- A `/files/:id` backend endpoint az egyetlen kapu — auth + jogosultság-check
-- + audit log. Privát R2 bucket alá írunk.

-- ============ FILES ============
CREATE TABLE IF NOT EXISTS files (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    -- Az R2 object key (vagy disk filename). Sose megy ki kliensre.
    storage_key     TEXT NOT NULL UNIQUE,
    -- 'r2' éles módban, 'disk' csak dev fallback
    storage_backend TEXT NOT NULL DEFAULT 'r2',
    -- A jogosultsági szabályok ezen alapulnak
    kind            TEXT NOT NULL,        -- 'kyc_license' | 'job_photo' | 'avatar'
    owner_id        UUID REFERENCES users(id) ON DELETE SET NULL,
    job_id          UUID REFERENCES jobs(id)  ON DELETE SET NULL,
    mime_type       TEXT,
    size_bytes      BIGINT,
    sha256          TEXT,                 -- integritás-ellenőrzés
    -- Soft delete: a `deleted_at` kitöltése után a streamelés 410-et ad,
    -- a tényleges R2 object is törlődik. Az audit log megőrződik.
    deleted_at      TIMESTAMPTZ,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_files_owner ON files(owner_id);
CREATE INDEX IF NOT EXISTS idx_files_kind  ON files(kind);
CREATE INDEX IF NOT EXISTS idx_files_job   ON files(job_id);

-- ============ FILE ACCESS LOG ============
-- Minden tényleges letöltést (és minden megtagadást) rögzítünk.
-- Hatóság/incidens esetén lekérhető: ki, mikor, hol.
CREATE TABLE IF NOT EXISTS file_access_log (
    id          BIGSERIAL PRIMARY KEY,
    file_id     UUID REFERENCES files(id) ON DELETE SET NULL,
    accessor_id UUID REFERENCES users(id) ON DELETE SET NULL,
    accessed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    ip          TEXT,
    user_agent  TEXT,
    -- 'ok' = stream sikeresen elkezdődött
    -- 'forbidden' = jogosultság-check megbukott
    -- 'not_found' = a file_id érvénytelen
    -- 'deleted'   = a file már soft-deleted
    -- 'token_invalid' = ?t=... aláírás-check megbukott
    result      TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_access_log_file     ON file_access_log(file_id, accessed_at DESC);
CREATE INDEX IF NOT EXISTS idx_access_log_accessor ON file_access_log(accessor_id, accessed_at DESC);

-- ============ ADATKEZELÉSI BELEEGYEZÉS ============
-- A user-nek kifejezetten el kell fogadnia a tájékoztatót KYC-feltöltéskor.
-- Ezt perzisztáljuk, hogy hatósági kérésnél bizonyíthassuk: igen, X user
-- 2026-05-09 12:34:56-kor elfogadta a "kyc_v1"-es szöveget.
CREATE TABLE IF NOT EXISTS data_consent_log (
    id            BIGSERIAL PRIMARY KEY,
    user_id       UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    consent_kind  TEXT NOT NULL,        -- 'kyc_upload' | 'tos' | 'marketing'
    text_version  TEXT NOT NULL,        -- pl. 'kyc_v1_2026-05-08'
    accepted_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    ip            TEXT
);
CREATE INDEX IF NOT EXISTS idx_consent_user ON data_consent_log(user_id, consent_kind);

-- ============ KAPCSOLAT A LÉTEZŐ TÁBLÁKHOZ ============
-- Új file_id mezők. A régi *_url oszlopok átmenetileg maradnak nullable-
-- ként, hogy a régi adat ne törjön el — az új kód file_id-t ír, olvasásnál
-- előbb a file_id-t próbálja, fallback a régi URL-re.
ALTER TABLE kyc_documents ADD COLUMN IF NOT EXISTS file_id        UUID REFERENCES files(id) ON DELETE SET NULL;
ALTER TABLE photos        ADD COLUMN IF NOT EXISTS file_id        UUID REFERENCES files(id) ON DELETE SET NULL;
ALTER TABLE users         ADD COLUMN IF NOT EXISTS avatar_file_id UUID REFERENCES files(id) ON DELETE SET NULL;

-- A régi URL-oszlopok NOT NULL constraint-jét fel kell oldani: az új kód
-- file_id-t ír, file_url-t / url-t pedig nem tölt — ezek nélkül az
-- INSERT-ek elhasalnának NOT NULL violation-nel.
ALTER TABLE kyc_documents ALTER COLUMN file_url DROP NOT NULL;
ALTER TABLE photos        ALTER COLUMN url      DROP NOT NULL;

COMMENT ON TABLE files IS 'Egységes file-tábla; minden upload itt landol metaadattal. Hozzáférés csak /files/:id-n keresztül, auth+audit-tal.';
COMMENT ON TABLE file_access_log IS 'GDPR audit log file letöltésekről — incidenshez és adatigényléshez.';
COMMENT ON TABLE data_consent_log IS 'Felhasználói beleegyezések rögzítése — különösen KYC-feltöltéshez.';
