-- =====================================================================
--  027_progressive_kyc.sql — Progresszív onboarding + B2B regisztráció
--
--  A KYC státuszt három különálló mezőre bontjuk:
--    1) identity_kyc_status: személyi igazolvány (mindenki)
--    2) driver_kyc_status: jogosítvány (sofőrök)
--    3) company_verification_status: céges verifikáció (cégek)
--
--  Új account_type mező: 'individual' vagy 'company'.
--  Céges regisztrációhoz: company_reg_number, eu_vat_number.
--  Fuvaroknál: invoice_requested mező.
-- =====================================================================

-- Account típus
ALTER TABLE users
    ADD COLUMN IF NOT EXISTS account_type TEXT NOT NULL DEFAULT 'individual';
DO $$ BEGIN
    ALTER TABLE users ADD CONSTRAINT chk_account_type
        CHECK (account_type IN ('individual', 'company'));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- Háromrészes KYC státusz
ALTER TABLE users
    ADD COLUMN IF NOT EXISTS identity_kyc_status TEXT NOT NULL DEFAULT 'none',
    ADD COLUMN IF NOT EXISTS driver_kyc_status TEXT NOT NULL DEFAULT 'none',
    ADD COLUMN IF NOT EXISTS company_verification_status TEXT NOT NULL DEFAULT 'none';

DO $$ BEGIN
    ALTER TABLE users ADD CONSTRAINT chk_identity_kyc
        CHECK (identity_kyc_status IN ('none', 'pending', 'verified', 'rejected'));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
    ALTER TABLE users ADD CONSTRAINT chk_driver_kyc
        CHECK (driver_kyc_status IN ('none', 'pending', 'verified', 'rejected'));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
    ALTER TABLE users ADD CONSTRAINT chk_company_verification
        CHECK (company_verification_status IN ('none', 'pending', 'verified', 'rejected'));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- Céges mezők (company_name, tax_id, billing_address már létezik a 016-os migrációból)
ALTER TABLE users
    ADD COLUMN IF NOT EXISTS company_reg_number TEXT,
    ADD COLUMN IF NOT EXISTS eu_vat_number TEXT;

-- Régi kyc_status adatok migrálása az új mezőkbe
UPDATE users SET identity_kyc_status = CASE
    WHEN kyc_status = 'verified' THEN 'verified'
    WHEN kyc_status = 'pending' THEN 'pending'
    WHEN kyc_status = 'suspended' THEN 'rejected'
    ELSE 'none'
END WHERE kyc_status IS NOT NULL AND kyc_status <> 'none'
  AND identity_kyc_status = 'none';

-- Ahol a jogosítvány approved, ott a driver_kyc_status is legyen verified
UPDATE users SET driver_kyc_status = 'verified'
WHERE id IN (
    SELECT user_id FROM kyc_documents
    WHERE doc_type = 'drivers_license' AND status = 'approved'
) AND driver_kyc_status = 'none';

-- Számla kérés mező a fuvarokon
ALTER TABLE jobs
    ADD COLUMN IF NOT EXISTS invoice_requested BOOLEAN NOT NULL DEFAULT FALSE;

-- Indexek
CREATE INDEX IF NOT EXISTS idx_users_account_type    ON users(account_type);
CREATE INDEX IF NOT EXISTS idx_users_identity_kyc    ON users(identity_kyc_status);
CREATE INDEX IF NOT EXISTS idx_users_company_verified ON users(company_verification_status)
    WHERE account_type = 'company';
