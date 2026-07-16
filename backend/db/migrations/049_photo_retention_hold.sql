-- Fotó-megőrzési zárolás (2026-07-16, user-döntés):
-- a felvételi/lerakós fotók alapból a fuvar lezárása után 30 nappal
-- törlődnek; vitarendezés VAGY admin-zárolás esetén az érintett
-- fuvar/foglalás fotói 5 évig maradnak. A flaget a vita-nyitás
-- automatikusan bekapcsolja (és a vita lezárása után is bekapcsolva
-- marad — a bizonyíték a Ptk-s igényérvényesítéshez kell).

ALTER TABLE jobs
    ADD COLUMN IF NOT EXISTS photo_retention_hold BOOLEAN NOT NULL DEFAULT FALSE;

ALTER TABLE route_bookings
    ADD COLUMN IF NOT EXISTS photo_retention_hold BOOLEAN NOT NULL DEFAULT FALSE;
