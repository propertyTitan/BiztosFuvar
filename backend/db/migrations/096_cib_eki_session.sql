-- 2026-09-29 (CIB PR-2/A): CIB EKI (SAKI 1.50) — egy payment_sessions sor
-- = egy banki kísérlet, a payment_id maga a 16 jegyű TRID. A négyállapotú
-- state és a 087/089/090-es triggerek VÁLTOZATLANOK: a CIB-lépés egy külön
-- alállapotban (cib_state) él, így a pénzügyi igazságforrás egy marad.
-- A cib_state NULL minden nem-CIB soron és a szimulált cib-stub-* sorokon is
-- (a CHECK ezt ki is kényszeríti).
-- Csak DDL: a rá épülő indexek a 097-ben (a futtató egy lekérdezésként adja
-- át a fájlt, a Postgres előre elemez). A 094-es notifications_sent_at már
-- a PR-1-ben bekerült, itt nem ismételjük.
ALTER TABLE payment_sessions
  ADD COLUMN IF NOT EXISTS cib_state TEXT,
  ADD COLUMN IF NOT EXISTS cib_hop_hash TEXT,
  ADD COLUMN IF NOT EXISTS cib_hop_expires_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS cib_redirected_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS cib_returned_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS cib_close_sent_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS cib_close_attempts SMALLINT NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS cib_query_count INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS cib_last_query_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS cib_next_action_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS cib_lease_until TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS cib_lease_owner TEXT,
  ADD COLUMN IF NOT EXISTS cib_result JSONB,
  ADD COLUMN IF NOT EXISTS cib_notified_at TIMESTAMPTZ;

ALTER TABLE payment_sessions DROP CONSTRAINT IF EXISTS payment_sessions_cib_check;
ALTER TABLE payment_sessions ADD CONSTRAINT payment_sessions_cib_check CHECK (
  cib_state IS NULL OR (
    provider = 'cib' AND NOT is_simulated AND payment_id ~ '^[0-9]{16}$'
    AND cib_state IN ('initializing','ready','redirected','authorized','closing','closed_ok',
                      'close_unknown','failed','expired','not_closed','abandoned','init_failed')
    AND cib_close_attempts BETWEEN 0 AND 3));

-- A bankkal váltott üzenetek csak bővülő naplója: a kimenő sor a küldés
-- ELŐTT, a bejövő utána kerül ide (autocommit). A raw a TITKOSÍTOTT szöveg
-- (vagy a titkosítatlan RC=Sxx/Dxx banki hiba) — a bank „tranzakció
-- kivizsgálás" kérésénél ezt kell átadni. Felhasználói oszlop nincs benne.
CREATE TABLE IF NOT EXISTS cib_messages (
  id BIGSERIAL PRIMARY KEY,
  payment_id TEXT CHECK (payment_id IS NULL OR payment_id ~ '^[0-9]{16}$'),
  direction TEXT NOT NULL CHECK (direction IN ('ki','be','bongeszo_ki','bongeszo_be')),
  msgt SMALLINT CHECK (msgt IN (10,11,20,21,31,32,33,37,38,70,71)),
  endpoint TEXT NOT NULL CHECK (endpoint IN ('market','customer','vissza')),
  http_status SMALLINT,
  rc TEXT CHECK (rc IS NULL OR char_length(rc) <= 3),
  raw TEXT NOT NULL CHECK (char_length(raw) <= 4000),
  error_class TEXT CHECK (error_class IN ('idokeret','halozat','nem_kuldott','visszafejtes',
                          'mezo_elteres','bank_S','bank_D','http')),
  close_attempt SMALLINT,
  duration_ms INTEGER,
  instance TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp()
);
