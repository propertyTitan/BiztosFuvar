-- 078 — A Járat-foglalás értékelése (élő hiba javítása)
--
-- ⚠️ EZ EGY SOHA NEM MŰKÖDŐ FUNKCIÓ VOLT, ÉLESBEN.
--
-- A `reviews.job_id` a kezdetektől `NOT NULL`. A 012-es migráció hozzáadta a
-- `booking_id`-t (hogy a fix áras Járat-foglalást is lehessen értékelni), DE a
-- `job_id` NOT NULL megkötését sosem oldotta fel. Következmény:
--
--     POST /reviews { booking_id: "...", stars: 5 }
--       → 23502 null value in column "job_id" violates not-null constraint
--       → a catch csak a 23505-öt kezeli → throw → 500 „Szerverhiba"
--
-- A web ténylegesen hívja ezt az utat (`Bookings.tsx` → `ReviewBox
-- entityKey="booking_id"`), tehát a foglalási ág TELJES értékelés-funkciója
-- halott volt, és minden próbálkozás Sentry-riasztást is generált.
--
-- Miért nem derült ki eddig: a meglévő tesztek a FUVAR-ágat mérték
-- (`job_id`-vel), a foglalási ágat egy sem. A hibát az elágazás-lefedettségi
-- kör hozta elő — pontosan az a fajta néma hiba, amiért a fedetlen hibaágakat
-- érdemes lefedni.
--
-- A JAVÍTÁS: a `job_id` lehet NULL, de PONTOSAN AZ EGYIK azonosítónak lennie
-- kell (CHECK). Így a „se fuvar, se foglalás" és a „mindkettő" eset is
-- adatbázis-szinten kizárt — utóbbi ma némán mindkét azonosítóval mentett.

ALTER TABLE reviews ALTER COLUMN job_id DROP NOT NULL;

-- Pontosan az egyik: XOR. (A `booking_id` a 012 óta létezik és nullázható.)
ALTER TABLE reviews
    DROP CONSTRAINT IF EXISTS reviews_entity_check;
ALTER TABLE reviews
    ADD CONSTRAINT reviews_entity_check
    CHECK ((job_id IS NOT NULL) <> (booking_id IS NOT NULL));
