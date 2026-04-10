-- Trust Score + Verified EU Carrier badge.

ALTER TABLE users
    ADD COLUMN IF NOT EXISTS trust_score         INTEGER NOT NULL DEFAULT 0,
    ADD COLUMN IF NOT EXISTS is_verified_carrier  BOOLEAN NOT NULL DEFAULT false,
    ADD COLUMN IF NOT EXISTS carrier_insurance_url TEXT,
    ADD COLUMN IF NOT EXISTS verified_at          TIMESTAMPTZ;

COMMENT ON COLUMN users.trust_score IS '0-100 pont, a sikeres fuvarok + értékelés + verifikáció alapján';
COMMENT ON COLUMN users.is_verified_carrier IS 'true ha EU VAT ID + biztosítás feltöltve + admin jóváhagyás';
