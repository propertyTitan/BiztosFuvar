-- =====================================================================
--  Teljes audit A4 (2026-09-11): integritás-kényszerek
--
--  1) disputes — pontosan EGY entitás (XOR, a régi OR helyett) + egyszerre
--     csak EGY nyitott vita per fuvar / foglalás (részleges UNIQUE index).
--     Eddig a kód ellenőrizte (SELECT → INSERT), két párhuzamos nyitás
--     kettőt hozott létre; a „mindkettő kitöltve" sort a CHECK átengedte.
--  2) reviews.reviewer_id — a TÖRÖLT értékelő nem viszi magával az
--     értékelést (CASCADE → SET NULL): a csillag marad („Törölt
--     felhasználó"), a szabad szöveget a fiók-törlés üríti (kód). Eddig a
--     törlés után a reviewee rating_count-ja több volt, mint a sorok száma.
--  3) escrow_transactions.job_id — a PÉNZÜGYI sor túléli a fuvar törlését
--     (Számv. tv. 169. § — 8 év): CASCADE → SET NULL. Egy admin fuvar-törlés
--     eddig a díj-könyvelést is elvitte.
-- =====================================================================

ALTER TABLE disputes DROP CONSTRAINT IF EXISTS disputes_check;
ALTER TABLE disputes DROP CONSTRAINT IF EXISTS disputes_entitas_xor;
ALTER TABLE disputes
  ADD CONSTRAINT disputes_entitas_xor CHECK ((job_id IS NOT NULL) <> (booking_id IS NOT NULL));

CREATE UNIQUE INDEX IF NOT EXISTS disputes_nyitott_fuvar_uq
  ON disputes (job_id) WHERE job_id IS NOT NULL AND status IN ('open', 'under_review');
CREATE UNIQUE INDEX IF NOT EXISTS disputes_nyitott_foglalas_uq
  ON disputes (booking_id) WHERE booking_id IS NOT NULL AND status IN ('open', 'under_review');

ALTER TABLE reviews ALTER COLUMN reviewer_id DROP NOT NULL;
ALTER TABLE reviews DROP CONSTRAINT IF EXISTS reviews_reviewer_id_fkey;
ALTER TABLE reviews
  ADD CONSTRAINT reviews_reviewer_id_fkey FOREIGN KEY (reviewer_id) REFERENCES users(id) ON DELETE SET NULL;
-- Az ÜGYLET törlése (a feladó fiók-törlése CASCADE-del viszi a fuvarjait) sem
-- vihette el a másik fél KAPOTT értékelését: job_id / booking_id SET NULL, a
-- 078-as XOR helyett „legfeljebb egy" (a két azonosító együtt továbbra is tilos).
ALTER TABLE reviews DROP CONSTRAINT IF EXISTS reviews_job_id_fkey;
ALTER TABLE reviews
  ADD CONSTRAINT reviews_job_id_fkey FOREIGN KEY (job_id) REFERENCES jobs(id) ON DELETE SET NULL;
ALTER TABLE reviews DROP CONSTRAINT IF EXISTS reviews_booking_id_fkey;
ALTER TABLE reviews
  ADD CONSTRAINT reviews_booking_id_fkey FOREIGN KEY (booking_id) REFERENCES route_bookings(id) ON DELETE SET NULL;
ALTER TABLE reviews DROP CONSTRAINT IF EXISTS reviews_entity_check;
ALTER TABLE reviews
  ADD CONSTRAINT reviews_entity_check CHECK (NOT (job_id IS NOT NULL AND booking_id IS NOT NULL));

ALTER TABLE escrow_transactions ALTER COLUMN job_id DROP NOT NULL;
ALTER TABLE escrow_transactions DROP CONSTRAINT IF EXISTS escrow_transactions_job_id_fkey;
ALTER TABLE escrow_transactions
  ADD CONSTRAINT escrow_transactions_job_id_fkey FOREIGN KEY (job_id) REFERENCES jobs(id) ON DELETE SET NULL;
