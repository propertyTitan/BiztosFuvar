-- 2026-09-29 (CIB PR-1): a díjfizetés utáni értesítések (szállítói in-app +
-- levél, feladói díj-visszaigazolás, job:paid socket) PONTOSAN EGYSZER mennek
-- ki díjbizonylatonként. Eddig az ismételt könyvelés (alreadyBooked, átvett
-- claim, a párhuzamos kézi nyugtázás vesztese) mindent újra kiküldött.
-- A claim: UPDATE … SET notifications_sent_at = NOW() WHERE … IS NULL.
-- Csak DDL: a meglévő sorok feltöltése a 095-ben (a futtató egy lekérdezésként
-- adja át a fájlt, a Postgres előre elemez).
ALTER TABLE fee_payment_receipts
  ADD COLUMN IF NOT EXISTS notifications_sent_at TIMESTAMPTZ;
