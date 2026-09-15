-- A fizetett állapottal együtt, egy tranzakcióban rögzített bizonylat.
-- A payment_events továbbra is hibát tűrő admin-napló; ez a helyreállítás alapja.
CREATE TABLE IF NOT EXISTS fee_payment_receipts (
  payment_id TEXT PRIMARY KEY,
  job_id UUID UNIQUE REFERENCES jobs(id) ON DELETE SET NULL,
  booking_id UUID UNIQUE REFERENCES route_bookings(id) ON DELETE SET NULL,
  shipper_id UUID REFERENCES users(id) ON DELETE SET NULL,
  fee_huf INTEGER NOT NULL CHECK (fee_huf > 0),
  currency TEXT NOT NULL DEFAULT 'HUF',
  paid_at TIMESTAMPTZ NOT NULL,
  invoice_pending BOOLEAN NOT NULL DEFAULT TRUE,
  last_invoice_attempt_at TIMESTAMPTZ,
  CHECK (job_id IS NULL OR booking_id IS NULL)
);
CREATE INDEX IF NOT EXISTS fee_receipts_invoice_pending
  ON fee_payment_receipts (last_invoice_attempt_at) WHERE invoice_pending;
