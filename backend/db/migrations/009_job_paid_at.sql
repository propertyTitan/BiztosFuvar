-- Licites fuvarok (jobs): `paid_at` a sikeres feladói fizetés időbélyegzője.
--
-- A route_bookings-hoz hasonlóan itt is a frontend ezt a mezőt használja
-- annak eldöntésére, hogy a feladói fuvar részletek oldalon a "Fizetés
-- Barionnal" gombot vagy az "✓ FIZETVE" feliratot mutassa. A sofőr
-- ugyanerről értesítést is kap (`job_paid` típus).
ALTER TABLE jobs
    ADD COLUMN IF NOT EXISTS paid_at TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS idx_jobs_paid_at ON jobs(paid_at);
