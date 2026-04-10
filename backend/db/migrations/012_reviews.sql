-- Értékelési rendszer: a fuvar lezárása után mindkét fél értékelheti
-- a másikat (1-5 csillag + opcionális szöveges megjegyzés).
--
-- A users táblán lévő rating_avg / rating_count oszlopokat egy
-- értékelés beírásakor a backend kódban frissítjük (nem triggerrel,
-- mert az átláthatóbb és könnyebben debugolható).

CREATE TABLE IF NOT EXISTS reviews (
    id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    -- Melyik fuvarra / foglalásra vonatkozik
    job_id       UUID REFERENCES jobs(id) ON DELETE CASCADE,
    booking_id   UUID REFERENCES route_bookings(id) ON DELETE CASCADE,
    -- Ki értékel, kit
    reviewer_id  UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    reviewee_id  UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    -- 1-5 csillag
    stars        INTEGER NOT NULL CHECK (stars >= 1 AND stars <= 5),
    comment      TEXT,
    created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    -- Egy reviewer egy entitásra csak egyszer értékelhet
    UNIQUE (job_id, reviewer_id),
    UNIQUE (booking_id, reviewer_id),
    -- Legalább egy entitás kell
    CHECK (job_id IS NOT NULL OR booking_id IS NOT NULL)
);

CREATE INDEX IF NOT EXISTS idx_reviews_reviewee ON reviews(reviewee_id);
CREATE INDEX IF NOT EXISTS idx_reviews_job      ON reviews(job_id);
CREATE INDEX IF NOT EXISTS idx_reviews_booking  ON reviews(booking_id);

-- Biztosítjuk, hogy a users tábla rendelkezzen rating oszlopokkal
-- (a schema.sql-ben benne van, de régi adatbázisoknál lefuthat ez
-- a migráció előbb mint a friss séma).
ALTER TABLE users
    ADD COLUMN IF NOT EXISTS rating_avg   NUMERIC(2,1) DEFAULT 0,
    ADD COLUMN IF NOT EXISTS rating_count INTEGER DEFAULT 0;
