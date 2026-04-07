-- Idempotens migráció: Barion Bridge mezők hozzáadása az escrow_transactions
-- táblához. Futtatható önállóan a már létező adatbázison is.

ALTER TABLE escrow_transactions
    ADD COLUMN IF NOT EXISTS barion_payment_id  TEXT,
    ADD COLUMN IF NOT EXISTS barion_gateway_url TEXT,
    ADD COLUMN IF NOT EXISTS carrier_share_huf  INTEGER,
    ADD COLUMN IF NOT EXISTS platform_share_huf INTEGER;
