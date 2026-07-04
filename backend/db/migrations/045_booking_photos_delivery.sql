-- 045: BUG-041 — a fix áras foglalás lezárhatóvá tétele.
--
-- A route_bookings enumban eddig is létezett az 'in_progress' és 'delivered'
-- állapot, a delivery_code-ot a címzett SMS-ben meg is kapta — de nem volt
-- végpont, ami a foglalást oda átvitte volna. A fotó-bizonyíték táblát
-- (photos) általánosítjuk: egy fotó mostantól fuvarhoz VAGY foglaláshoz
-- tartozik.

ALTER TABLE photos ALTER COLUMN job_id DROP NOT NULL;
ALTER TABLE photos ADD COLUMN IF NOT EXISTS booking_id UUID REFERENCES route_bookings(id) ON DELETE CASCADE;

-- Minden fotónak pontosan egy szülője legyen (fuvar vagy foglalás)
DO $$ BEGIN
    ALTER TABLE photos ADD CONSTRAINT photos_parent_check
        CHECK (job_id IS NOT NULL OR booking_id IS NOT NULL);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE INDEX IF NOT EXISTS idx_photos_booking ON photos(booking_id);

-- Kód brute-force védelem a foglalás-lezáráshoz (a jobs mintájára)
ALTER TABLE route_bookings ADD COLUMN IF NOT EXISTS delivery_code_attempts INTEGER NOT NULL DEFAULT 0;
ALTER TABLE route_bookings ADD COLUMN IF NOT EXISTS delivery_code_locked_until TIMESTAMPTZ;
