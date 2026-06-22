-- =====================================================================
--  043_user_activity_tracking.sql — Felhasználói aktivitás-naplózás.
--
--  Az adminnak: ki mikor lépett be utoljára, hányszor lépett be, mikor
--  látták utoljára aktívan, és összesen kb. hány percet használta az
--  oldalt.
--
--    last_login_at        — utolsó sikeres bejelentkezés ideje
--    login_count          — összes sikeres bejelentkezés száma
--    last_seen_at         — utolsó élő aktivitás (socket-kapcsolat)
--    total_active_seconds — összes aktív idő mp-ben (socket-élettartamból
--                           gyűjtve; becsült, mert a tab nyitva-tartása a
--                           proxy az "oldal használata"-ra)
-- =====================================================================

ALTER TABLE users ADD COLUMN IF NOT EXISTS last_login_at TIMESTAMPTZ;
ALTER TABLE users ADD COLUMN IF NOT EXISTS login_count INTEGER NOT NULL DEFAULT 0;
ALTER TABLE users ADD COLUMN IF NOT EXISTS last_seen_at TIMESTAMPTZ;
ALTER TABLE users ADD COLUMN IF NOT EXISTS total_active_seconds BIGINT NOT NULL DEFAULT 0;
