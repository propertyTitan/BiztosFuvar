-- =====================================================================
--  054_admin_uzenetek.sql — admin ↔ felhasználó üzenetküldés
--
--  IGÉNY (2026-08-08, user-döntés): az admin tudjon üzenni egy konkrét
--  felhasználónak ÉS mindenkinek (körüzenet) — de a felhasználó MAGÁTÓL
--  ne tudjon írni az adminnak. A csatorna csak akkor nyílik meg a user
--  felé, ha az admin KÖZVETLEN üzenetet küldött neki. A körüzenet NEM
--  nyitja meg (különben az első körüzenet után mindenki írhatna).
--
--  Modell: userenként EGY szál az adminnal (admin_messages.user_id a
--  szál kulcsa). A `kind` különbözteti meg a közvetlen üzenetet, a
--  körüzenet-példányt és a user válaszát. A read_at mindig a MÁSIK
--  oldal olvasás-visszajelzése (admin üzeneténél: a user elolvasta;
--  user válaszánál: az admin elolvasta).
-- =====================================================================

CREATE TABLE IF NOT EXISTS admin_broadcasts (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    admin_id        UUID REFERENCES users(id) ON DELETE SET NULL,
    target          TEXT NOT NULL CHECK (target IN ('all', 'shippers', 'carriers', 'company')),
    body            TEXT NOT NULL,
    recipient_count INTEGER NOT NULL DEFAULT 0,
    email_sent      BOOLEAN NOT NULL DEFAULT FALSE,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS admin_messages (
    id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    -- A szál gazdája (a felhasználó, akivel az admin beszélget).
    -- Fiók-törléskor a szál is megy (nincs pénz-vonzata, GDPR-barát).
    user_id      UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    -- Ki írta: 'admin' vagy 'user' (a user_id gazdája).
    sender       TEXT NOT NULL CHECK (sender IN ('admin', 'user')),
    -- Melyik admin írta (ha admin írta); admin-törlésnél megmarad a szál.
    admin_id     UUID REFERENCES users(id) ON DELETE SET NULL,
    -- 'direct' = közvetlen admin-üzenet (EZ nyitja meg a válasz-csatornát)
    -- 'broadcast' = körüzenet-példány (NEM nyit csatornát)
    -- 'user_reply' = a felhasználó válasza
    kind         TEXT NOT NULL CHECK (kind IN ('direct', 'broadcast', 'user_reply')),
    broadcast_id UUID REFERENCES admin_broadcasts(id) ON DELETE SET NULL,
    body         TEXT NOT NULL,
    -- A másik oldal mikor olvasta (admin-üzenetnél a user, user-válasznál az admin).
    read_at      TIMESTAMPTZ,
    created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_admin_messages_user
    ON admin_messages(user_id, created_at);

-- Az admin-oldali "olvasatlan válaszok" badge gyors számlálásához.
CREATE INDEX IF NOT EXISTS idx_admin_messages_unread_user_replies
    ON admin_messages(user_id)
    WHERE sender = 'user' AND read_at IS NULL;

COMMENT ON TABLE admin_messages IS
  'Admin ↔ felhasználó üzenet-szálak. A user csak akkor válaszolhat, ha van direct admin-üzenete (a broadcast nem nyit csatornát).';
COMMENT ON TABLE admin_broadcasts IS
  'Admin körüzenetek naplója (célzás + címzett-szám); a példányok az admin_messages-ben, broadcast_id-vel.';
