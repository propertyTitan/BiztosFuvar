-- =====================================================================
--  056_fizetesi_emlekezteto.sql — fizetetlen-fuvar emlékeztető állapota
--
--  IGÉNY (2026-08-09, több-ügynökös átvizsgálás #1 termék-találata): a
--  megállapodás (accepted) után, de a kapcsolatfelvételi díj kifizetése
--  ELŐTT a tranzakció ma védtelen — a feladó (a fizető) jellemzően nincs
--  az oldalon, és semmi nem hívja vissza. A platform bevétele ezen a
--  lépcsőn múlik. Egy napi emlékeztető-kör (services/paymentReminders.js)
--  az accepted + paid_at IS NULL fuvarokra email + in-app értesítést küld;
--  ez a két oszlop számolja, hányszor és mikor emlékeztettünk (max 2).
-- =====================================================================

ALTER TABLE jobs
  ADD COLUMN IF NOT EXISTS payment_reminder_count INTEGER NOT NULL DEFAULT 0;

ALTER TABLE jobs
  ADD COLUMN IF NOT EXISTS last_payment_reminder_at TIMESTAMPTZ;

COMMENT ON COLUMN jobs.payment_reminder_count IS
  'Hány fizetési emlékeztetőt küldtünk az accepted+fizetetlen fuvarra (max 2). A díj kifizetésekor irreleváns.';
COMMENT ON COLUMN jobs.last_payment_reminder_at IS
  'Az utolsó fizetési emlékeztető időbélyege — a következő emlékeztető ütemezését ez vezérli (stabil, szemben az updated_at-tal).';
