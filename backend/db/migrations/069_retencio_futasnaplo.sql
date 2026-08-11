-- 069 — A retenciós kör futás-naplója
--
-- HIÁNY (2026-08-10, séma-audit): minden purge LENYELI a saját hibáját
-- (`catch` + console.error), az ütemező pedig `.catch(() => {})`-tal hív.
-- Nincs Sentry-jelzés (szemben az sms.js reportSmsFailure-jével), és nincs
-- futás-nyom. Ha egy séma-változás vagy jogosultsági hiba miatt a kör
-- hónapokig elszáll, azt SEMMI nem jelzi — és utólag bizonyítani sem lehet,
-- hogy valaha lefutott.
--
-- A GDPR 5. cikk (2) (elszámoltathatóság) épp ezt kéri: nem elég betartani a
-- megőrzési időket, bizonyítani is kell tudni. Egy hatósági vizsgálatnál pont
-- ez a bizonyíték hiányzott.
--
-- A napló SEMMILYEN személyes adatot nem tartalmaz: mit futtattunk, mikor,
-- hány sort érintett, és hibázott-e.

CREATE TABLE IF NOT EXISTS retention_runs (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    started_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    finished_at TIMESTAMPTZ,
    -- { "purgeOldChatMessages": 12, "anonymizeOldJobs": 3, ... }
    eredmeny    JSONB NOT NULL DEFAULT '{}'::jsonb,
    -- { "purgeOldInvoices": "column ... does not exist" }
    hibak       JSONB NOT NULL DEFAULT '{}'::jsonb,
    ok          BOOLEAN NOT NULL DEFAULT TRUE
);

CREATE INDEX IF NOT EXISTS idx_retention_runs_started ON retention_runs (started_at DESC);
