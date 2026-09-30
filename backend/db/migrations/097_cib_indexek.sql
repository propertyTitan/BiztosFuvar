-- 2026-09-29 (CIB PR-2/A): a 096-os CIB-oszlopokra épülő indexek (külön
-- fájlban, mert a futtató a teljes fájlt egy lekérdezésként adja át).
--
-- Fuvaronként (foglalásonként) legfeljebb EGY zárási sor: két párhuzamos,
-- mindkettő jóváhagyott kísérlet közül így csak egy juthat el a MSGT32-ig —
-- a kettős terhelés ellen ez a DB-szintű végső védelem (a második 23505-öt
-- kap, és a bank magától feloldja a zárolását).
CREATE UNIQUE INDEX IF NOT EXISTS payment_sessions_cib_egy_zaras_job ON payment_sessions(job_id)
  WHERE job_id IS NOT NULL AND cib_state IN ('closing','close_unknown','closed_ok');
CREATE UNIQUE INDEX IF NOT EXISTS payment_sessions_cib_egy_zaras_booking ON payment_sessions(booking_id)
  WHERE booking_id IS NOT NULL AND cib_state IN ('closing','close_unknown','closed_ok');
-- Az egyszer használatos átirányító link (hop) hash-e egyedi.
CREATE UNIQUE INDEX IF NOT EXISTS payment_sessions_cib_hop ON payment_sessions(cib_hop_hash)
  WHERE cib_hop_hash IS NOT NULL;
-- A lekérdező kör teendő-listája: csak a még függő CIB-kísérletek.
CREATE INDEX IF NOT EXISTS payment_sessions_cib_teendo ON payment_sessions(cib_next_action_at)
  WHERE provider = 'cib' AND state = 'pending' AND cib_state IS NOT NULL;
CREATE INDEX IF NOT EXISTS cib_messages_payment_idx ON cib_messages(payment_id, id);
CREATE INDEX IF NOT EXISTS cib_messages_created_idx ON cib_messages(created_at);
