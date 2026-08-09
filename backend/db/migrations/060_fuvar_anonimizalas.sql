-- 060 — A lezárt fuvarok/foglalások személyes adatainak anonimizálása
--
-- MIÉRT: a `jobs` és a `route_bookings` táblának SEMMILYEN megőrzési ideje nem
-- volt (2026-08-09 adatvédelmi audit). A köré épült adatokat gépiesen töröltük
-- (fotó 30 nap, chat 6 hónap, GPS-ping 7 nap, értesítés 6 hónap), de maga a
-- fuvar-sor — benne a PONTOS felvételi és lerakodási címmel, a koordinátákkal,
-- a címzett teljes elérhetőségével és a csomag deklarált értékével — örökre
-- megmaradt. A GDPR 5. cikk (1) e) pontja (korlátozott tárolhatóság) ezt nem
-- engedi, és az adatkezelési tájékoztató sem adott rá megőrzési időt.
--
-- TÖRLÉS HELYETT ANONIMIZÁLÁS: a fuvar TÉNYE üzletileg kell (statisztika,
-- értékelés-előzmény, elszámolás), a személyes adat viszont nem. Ez az oszlop
-- jelöli, hogy egy soron már lefutott az anonimizálás — enélkül a napi kör
-- minden nap újra végigfutna az összes régi soron.

ALTER TABLE jobs
    ADD COLUMN IF NOT EXISTS anonymized_at TIMESTAMPTZ;

ALTER TABLE route_bookings
    ADD COLUMN IF NOT EXISTS anonymized_at TIMESTAMPTZ;

-- Csak a még nem anonimizált, lezárt sorokat keressük naponta.
CREATE INDEX IF NOT EXISTS idx_jobs_anonimizalando
    ON jobs (updated_at)
    WHERE anonymized_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_bookings_anonimizalando
    ON route_bookings (created_at)
    WHERE anonymized_at IS NULL;
