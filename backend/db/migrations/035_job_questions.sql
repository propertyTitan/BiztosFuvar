-- =====================================================================
--  Publikus kérdés-válasz (Q&A) a fuvarokhoz.
--
--  Cél: a sofőrök ne kelljen ugyanazt a kérdést 15-ször feltenniük chat-ben.
--  Egy közös Q&A blokk a fuvar oldalon, ahol bárki kérdezhet, a feladó
--  válaszol — minden látható mindenkinek.
--
--  Hasonló: Vatera kérdés-válasz, eBay Q&A.
-- =====================================================================

CREATE TABLE IF NOT EXISTS job_questions (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    job_id          UUID NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
    asker_id        UUID NOT NULL REFERENCES users(id) ON DELETE SET NULL,
    question        TEXT NOT NULL,
    answer          TEXT,
    answered_by     UUID REFERENCES users(id) ON DELETE SET NULL,
    answered_at     TIMESTAMPTZ,
    hidden          BOOLEAN NOT NULL DEFAULT false,  -- admin moderáció / spam-szűrés
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_job_questions_job ON job_questions(job_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_job_questions_asker ON job_questions(asker_id);

COMMENT ON TABLE job_questions IS 'Publikus Q&A a fuvarokhoz — bárki kérdezhet, a feladó válaszol, mindenki látja.';
COMMENT ON COLUMN job_questions.hidden IS 'Admin moderációs flag — spam / nem-megfelelő tartalom eltávolítás.';
