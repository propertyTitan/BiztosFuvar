-- 2026-10-03 (CIB PR-5/B): a fuvaronkénti (foglalásonkénti) egy-zárási index
-- ne foglalja örökre a helyet egy VISSZATÉRÍTETT könyvelési árvával.
--
-- A könyvelési árva (a bank terhelt, de a fuvar a zárás pillanatában már nem
-- volt fizethető) az admin „visszaterites" művelete után state = 'closed',
-- closed_reason = 'admin_visszaterites' lesz, a cib_state viszont IGAZAN
-- closed_ok marad (a bank lezárta, mi visszaadtuk). A 097-es részleges UNIQUE
-- index csak a cib_state-et nézte, így ez a sor a fuvar egyetlen zárási
-- helyét örökre foglalta: ha a fuvar újra elfogadott és fizethető lett, az új
-- kártyás kísérlet zárása 23505-öt kapott (a feladó jóváhagyott, a bank
-- visszautalt, fizetni nem tudott). A visszatérített sor már nem fizetés a
-- díjra, ezért kikerül az indexből; két ÉLŐ zárási sor továbbra sem lehet.
--
-- Az indexnevek változatlanok (a séma-őr név szerint méri). Egy fájl, egy
-- implicit tranzakció: a régi index eldobása és az új létrehozása között nincs
-- védtelen pillanat. Csak DDL.
DROP INDEX IF EXISTS payment_sessions_cib_egy_zaras_job;
CREATE UNIQUE INDEX IF NOT EXISTS payment_sessions_cib_egy_zaras_job ON payment_sessions(job_id)
  WHERE job_id IS NOT NULL AND cib_state IN ('closing','close_unknown','closed_ok')
    AND closed_reason IS DISTINCT FROM 'admin_visszaterites';
DROP INDEX IF EXISTS payment_sessions_cib_egy_zaras_booking;
CREATE UNIQUE INDEX IF NOT EXISTS payment_sessions_cib_egy_zaras_booking ON payment_sessions(booking_id)
  WHERE booking_id IS NOT NULL AND cib_state IN ('closing','close_unknown','closed_ok')
    AND closed_reason IS DISTINCT FROM 'admin_visszaterites';
