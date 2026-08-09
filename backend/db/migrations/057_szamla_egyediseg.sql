-- 057 — Számla-egyediség: ügyletenként legfeljebb EGY (nem hibás) számla.
--
-- Miért: a kapcsolatfelvételi díj számlája ADÓÜGYI dokumentum. A fizetési
-- webhookot a PSP-k rutinszerűen újraküldik (retry), és a `confirmFeePayment`
-- nem tranzakcionális: két PÁRHUZAMOS callback mindkettő átment az
-- idempotencia-ellenőrzésen (a `processed` flag csak a feldolgozás VÉGÉN
-- íródik ki), és MINDKETTŐ kiállított volna egy valódi számlát a
-- Számlázz.hu-n. A duplikátumot csak sztornóval lehet javítani, a vevő
-- pedig két számlát kap ugyanarról a díjról.
--
-- Az index a DB szintjén zárja ki ezt: az `invoicing.js` előbb foglal egy
-- 'pending' sort (ON CONFLICT DO NOTHING), és csak a nyertes hívja a
-- számlázó providert. A 'failed' sorok szándékosan kimaradnak a feltételből,
-- hogy egy sikertelen kiállítás után lehessen újrapróbálni.

CREATE UNIQUE INDEX IF NOT EXISTS invoices_job_egyedi
    ON invoices (job_id)
    WHERE job_id IS NOT NULL AND status <> 'failed';

CREATE UNIQUE INDEX IF NOT EXISTS invoices_booking_egyedi
    ON invoices (booking_id)
    WHERE booking_id IS NOT NULL AND status <> 'failed';
