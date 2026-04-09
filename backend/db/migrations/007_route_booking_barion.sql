-- Idempotens migráció: a route_bookings táblához hozzáadjuk a Barion
-- payment_id és gateway_url mezőket, plusz a carrier/platform split
-- összegeket, hogy a sofőr megerősítés után a FELADÓ is tudjon fizetni
-- a Barionon (az URL elmentésre kerül a booking sorába).

ALTER TABLE route_bookings
    ADD COLUMN IF NOT EXISTS barion_payment_id  TEXT,
    ADD COLUMN IF NOT EXISTS barion_gateway_url TEXT,
    ADD COLUMN IF NOT EXISTS carrier_share_huf  INTEGER,
    ADD COLUMN IF NOT EXISTS platform_share_huf INTEGER;
