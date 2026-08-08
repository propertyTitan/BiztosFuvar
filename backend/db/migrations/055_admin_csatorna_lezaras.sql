-- =====================================================================
--  055_admin_csatorna_lezaras.sql — admin-üzenet csatorna némítása
--
--  A 054-es admin-üzenetküldés átvizsgálásának (2026-08-08) találata:
--  ha az admin egyszer közvetlen üzenetet küldött, a user ÖRÖKRE
--  válaszolhatott — visszaélésnél (spam, abúzus) nem volt lezárás.
--  Ez az oszlop a "csatorna zárva" jelző: ha ki van töltve, a user
--  válasza 403 CHANNEL_CLOSED (az admin továbbra is írhat, és a
--  lezárás bármikor feloldható).
-- =====================================================================

ALTER TABLE users
  ADD COLUMN IF NOT EXISTS admin_channel_closed_at TIMESTAMPTZ;

COMMENT ON COLUMN users.admin_channel_closed_at IS
  'Ha kitöltött: az admin lezárta a user válasz-csatornáját (a user nem írhat az adminnak, az admin igen). NULL = a normál csatorna-szabály él.';
