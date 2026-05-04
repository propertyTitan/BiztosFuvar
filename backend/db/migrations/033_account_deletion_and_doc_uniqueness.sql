-- =====================================================================
--  033_account_deletion_and_doc_uniqueness.sql
--
--  1) Fiók törlés audit log — GDPR "elfeledtetéshez való jog"
--  2) Dokumentum szám egyediség — egy személyi = egy fiók
-- =====================================================================

-- Törölt fiókok audit logja (GDPR: tudnunk kell hogy törölve lett)
CREATE TABLE IF NOT EXISTS deleted_accounts (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    original_user_id UUID NOT NULL,
    email_hash      TEXT NOT NULL,
    reason          TEXT,
    deleted_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Dokumentum szám tárolás az egyediség ellenőrzéshez
ALTER TABLE kyc_documents
    ADD COLUMN IF NOT EXISTS doc_number_hash TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS idx_kyc_doc_number_unique
    ON kyc_documents(doc_number_hash)
    WHERE doc_number_hash IS NOT NULL AND status IN ('approved', 'pending');
