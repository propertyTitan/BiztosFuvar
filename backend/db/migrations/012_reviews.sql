-- Értékelési rendszer: bővítjük a meglévő reviews táblát a booking
-- támogatással és az új stars oszloppal (a régi rating mellé).
--
-- Idempotens: ADD COLUMN IF NOT EXISTS, CREATE INDEX IF NOT EXISTS.

-- Új oszlopok a meglévő reviews táblához
ALTER TABLE reviews
    ADD COLUMN IF NOT EXISTS booking_id  UUID REFERENCES route_bookings(id) ON DELETE CASCADE,
    ADD COLUMN IF NOT EXISTS stars       INTEGER,
    ADD COLUMN IF NOT EXISTS reviewee_id UUID REFERENCES users(id) ON DELETE CASCADE;

-- Ha a régi rating oszlop létezik és a stars üres, másoljuk át
UPDATE reviews SET stars = rating WHERE stars IS NULL AND rating IS NOT NULL;

-- Index + UNIQUE constraint-ek (nem dobnak hibát ha már léteznek)
CREATE UNIQUE INDEX IF NOT EXISTS idx_reviews_job_reviewer
    ON reviews(job_id, reviewer_id) WHERE job_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS idx_reviews_booking_reviewer
    ON reviews(booking_id, reviewer_id) WHERE booking_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_reviews_reviewee ON reviews(reviewee_id);
CREATE INDEX IF NOT EXISTS idx_reviews_job      ON reviews(job_id);
CREATE INDEX IF NOT EXISTS idx_reviews_booking  ON reviews(booking_id);

-- Biztosítjuk, hogy a users tábla rendelkezzen rating oszlopokkal
ALTER TABLE users
    ADD COLUMN IF NOT EXISTS rating_avg   NUMERIC(2,1) DEFAULT 0,
    ADD COLUMN IF NOT EXISTS rating_count INTEGER DEFAULT 0;
