-- Route bookings: `paid_at` a sikeres feladói fizetés időbélyegzője.
--
-- Jelenleg STUB módban fut a fizetés, de ugyanezt az oszlopot tölti majd
-- a valódi Barion callback is (payments.js /barion/callback endpoint),
-- amikor élesedik a POS kulcs. A frontend ezt az egy mezőt használja
-- annak eldöntésére, hogy a foglaláson a "Fizetés Barionnal" gombot
-- vagy az "✓ FIZETVE" feliratot mutassa.
ALTER TABLE route_bookings
    ADD COLUMN IF NOT EXISTS paid_at TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS idx_bookings_paid_at ON route_bookings(paid_at);
