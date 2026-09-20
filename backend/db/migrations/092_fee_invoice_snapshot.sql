-- A számla első kiállítása és pótlása ugyanabból a fizetéskori adatból dolgozik.
-- A régi sorokat nem töltjük fel az azóta megváltozhatott profiladatokkal.
-- Snapshot nélküli, még ki nem állított régi számlához kézi egyeztetés kell.
ALTER TABLE fee_payment_receipts
  ADD COLUMN IF NOT EXISTS invoice_snapshot JSONB;
