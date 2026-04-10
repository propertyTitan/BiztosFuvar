-- GoFuvar KYC + Jogosítvány + Biztonsági protokoll.

-- ============ KYC DOKUMENTUMOK ============
CREATE TABLE IF NOT EXISTS kyc_documents (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id         UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    doc_type        TEXT NOT NULL,       -- 'id_card' | 'drivers_license' | 'insurance' | 'vehicle_registration'
    file_url        TEXT NOT NULL,
    -- OCR-ből kinyert adatok
    doc_number      TEXT,
    full_name_on_doc TEXT,
    expiry_date     DATE,
    -- Verifikáció
    status          TEXT NOT NULL DEFAULT 'pending',  -- pending | approved | rejected | expired
    reviewed_by     UUID REFERENCES users(id) ON DELETE SET NULL,
    reviewed_at     TIMESTAMPTZ,
    rejection_reason TEXT,
    -- Lejárati értesítések
    expiry_warned_30d BOOLEAN DEFAULT false,
    expiry_warned_7d  BOOLEAN DEFAULT false,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (user_id, doc_type)
);
CREATE INDEX IF NOT EXISTS idx_kyc_user   ON kyc_documents(user_id);
CREATE INDEX IF NOT EXISTS idx_kyc_expiry ON kyc_documents(expiry_date) WHERE status = 'approved';

-- A user tábla bővítése KYC státusszal
ALTER TABLE users
    ADD COLUMN IF NOT EXISTS kyc_status     TEXT NOT NULL DEFAULT 'none',  -- none | pending | verified | suspended
    ADD COLUMN IF NOT EXISTS kyc_verified_at TIMESTAMPTZ,
    ADD COLUMN IF NOT EXISTS license_expiry  DATE,
    ADD COLUMN IF NOT EXISTS can_bid         BOOLEAN NOT NULL DEFAULT true;

COMMENT ON COLUMN users.can_bid IS 'false ha a jogosítvány lejárt → nem licitálhat';
