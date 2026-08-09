-- 059 — Admin-hozzáférési napló (elszámoltathatóság, GDPR 5. cikk (2), 32. cikk)
--
-- MIÉRT: az adatkezelési tájékoztató „File-hozzáférési audit log: 1 évig"
-- megőrzést ígér, a rendszerben viszont SEMMILYEN ilyen napló nem létezett
-- (2026-08-09 adatvédelmi audit). A legérzékenyebb adatokhoz — a személyi
-- igazolvány fotójához (aláírt olvasó-linkkel), a felek PRIVÁT chatjéhez és a
-- teljes felhasználói részletnézethez — az admin nyomtalanul hozzáfért.
-- Incidens esetén nem lehetett volna megmondani, ki mit látott, ami az
-- incidenskezelési terv 72 órás értékelését is ellehetetleníti.
--
-- Amit NAPLÓZUNK: ki (admin), mit csinált (művelet), melyik entitáson,
-- mikor. Amit NEM: maga a megtekintett tartalom — a napló nem lehet a
-- kiszivárgott adat második példánya.

CREATE TABLE IF NOT EXISTS admin_access_log (
    id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    -- A napló az adminról szól, de a törlése nem tüntetheti el a nyomot:
    -- SET NULL (nem CASCADE), az `admin_email_hash` pedig azonosít utólag is.
    admin_id     UUID REFERENCES users(id) ON DELETE SET NULL,
    action       TEXT NOT NULL,          -- pl. 'kyc_documents_list', 'chat_read', 'user_detail'
    target_type  TEXT,                   -- 'user' | 'job' | 'booking' | NULL
    target_id    UUID,
    created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_admin_access_log_admin   ON admin_access_log(admin_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_admin_access_log_target  ON admin_access_log(target_type, target_id);
CREATE INDEX IF NOT EXISTS idx_admin_access_log_created ON admin_access_log(created_at);
