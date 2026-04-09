-- =====================================================================
--  Értesítések (notifications)
--
--  Minden fontos eseményhez egy sor ebbe a táblába: új licit, licit
--  elfogadás, új foglalás, foglalás megerősítés/elutasítás, fuvar
--  lezárás, stb. A felhasználó egy központi "Értesítések" oldalon látja
--  mindet, és a real-time Socket.IO értesíti, amikor új notif érkezik
--  neki.
-- =====================================================================

CREATE TABLE IF NOT EXISTS notifications (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id     UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    type        TEXT NOT NULL,     -- pl. 'bid_received', 'booking_confirmed'
    title       TEXT NOT NULL,
    body        TEXT,
    link        TEXT,              -- kattintható cél az app-on belül
    read_at     TIMESTAMPTZ,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_notifications_user_created
    ON notifications(user_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_notifications_user_unread
    ON notifications(user_id) WHERE read_at IS NULL;
