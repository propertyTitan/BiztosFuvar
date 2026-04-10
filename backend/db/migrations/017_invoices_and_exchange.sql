-- Számla tábla + árfolyam-befagyasztás mezők.

-- Számlák (platform jutalékról)
CREATE TABLE IF NOT EXISTS invoices (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    job_id              UUID REFERENCES jobs(id) ON DELETE SET NULL,
    booking_id          UUID REFERENCES route_bookings(id) ON DELETE SET NULL,
    buyer_user_id       UUID REFERENCES users(id) ON DELETE SET NULL,
    buyer_name          TEXT,
    buyer_tax_id        TEXT,
    buyer_address       TEXT,
    buyer_country       TEXT DEFAULT 'HU',
    currency            TEXT NOT NULL DEFAULT 'HUF',
    net_amount          INTEGER NOT NULL,
    vat_rate            NUMERIC(4,3) NOT NULL DEFAULT 0.27,
    vat_amount          INTEGER NOT NULL DEFAULT 0,
    gross_amount        INTEGER NOT NULL,
    is_reverse_charge   BOOLEAN NOT NULL DEFAULT false,
    external_system     TEXT,
    external_id         TEXT,
    invoice_number      TEXT,
    pdf_url             TEXT,
    status              TEXT NOT NULL DEFAULT 'pending',
    created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_invoices_job     ON invoices(job_id);
CREATE INDEX IF NOT EXISTS idx_invoices_booking ON invoices(booking_id);
CREATE INDEX IF NOT EXISTS idx_invoices_buyer   ON invoices(buyer_user_id);

-- Árfolyam befagyasztás a licit / foglalás pillanatában
ALTER TABLE bids
    ADD COLUMN IF NOT EXISTS currency            TEXT DEFAULT 'HUF',
    ADD COLUMN IF NOT EXISTS exchange_rate        NUMERIC(10,4),
    ADD COLUMN IF NOT EXISTS exchange_rate_frozen_at TIMESTAMPTZ;

ALTER TABLE escrow_transactions
    ADD COLUMN IF NOT EXISTS exchange_rate        NUMERIC(10,4),
    ADD COLUMN IF NOT EXISTS exchange_rate_frozen_at TIMESTAMPTZ;
