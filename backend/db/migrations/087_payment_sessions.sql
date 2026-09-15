-- Stabil fizetési kapcsolat: az új próbálkozás nem tünteti el a régit.
-- Nincs CASCADE: a minimális pénzügyi nyom a lezárt fiókot is túléli.
CREATE TABLE IF NOT EXISTS payment_sessions (
  payment_id TEXT PRIMARY KEY,
  job_id UUID,
  booking_id UUID,
  shipper_id UUID NOT NULL,
  carrier_id UUID,
  amount_huf INTEGER NOT NULL,
  currency TEXT NOT NULL DEFAULT 'HUF',
  state TEXT NOT NULL DEFAULT 'pending' CHECK(state IN ('pending', 'succeeded', 'closed', 'needs_review')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  settled_at TIMESTAMPTZ,
  CHECK ((job_id IS NULL) <> (booking_id IS NULL))
);
CREATE INDEX IF NOT EXISTS payment_sessions_shipper_pending ON payment_sessions(shipper_id) WHERE state IN ('pending', 'needs_review');
CREATE INDEX IF NOT EXISTS payment_sessions_carrier_pending ON payment_sessions(carrier_id) WHERE state IN ('pending', 'needs_review');
CREATE INDEX IF NOT EXISTS payment_sessions_job ON payment_sessions(job_id);
CREATE INDEX IF NOT EXISTS payment_sessions_booking ON payment_sessions(booking_id);

-- Minden jelenlegi író út ugyanabban a tranzakcióban rögzíti a sessiont.
CREATE OR REPLACE FUNCTION remember_fee_payment_session() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.barion_payment_id IS NULL OR NEW.barion_payment_id = '' THEN RETURN NEW; END IF;
  IF TG_TABLE_NAME = 'escrow_transactions' THEN
    INSERT INTO payment_sessions(payment_id, job_id, shipper_id, carrier_id, amount_huf, currency)
      SELECT NEW.barion_payment_id, j.id, j.shipper_id, j.carrier_id, NEW.amount_huf, COALESCE(NEW.currency, 'HUF')
      FROM jobs j WHERE j.id = NEW.job_id
      ON CONFLICT(payment_id) DO NOTHING;
  ELSE
    INSERT INTO payment_sessions(payment_id, booking_id, shipper_id, carrier_id, amount_huf)
      SELECT NEW.barion_payment_id, NEW.id, NEW.shipper_id, r.carrier_id, COALESCE(NEW.connection_fee_huf, 0)
      FROM carrier_routes r WHERE r.id = NEW.route_id
      ON CONFLICT(payment_id) DO NOTHING;
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS remember_job_fee_session ON escrow_transactions;
CREATE TRIGGER remember_job_fee_session AFTER INSERT OR UPDATE OF barion_payment_id ON escrow_transactions
  FOR EACH ROW EXECUTE FUNCTION remember_fee_payment_session();
DROP TRIGGER IF EXISTS remember_booking_fee_session ON route_bookings;
CREATE TRIGGER remember_booking_fee_session AFTER INSERT OR UPDATE OF barion_payment_id ON route_bookings
  FOR EACH ROW EXECUTE FUNCTION remember_fee_payment_session();

INSERT INTO payment_sessions(payment_id, job_id, shipper_id, carrier_id, amount_huf, currency, created_at)
  SELECT e.barion_payment_id, j.id, j.shipper_id, j.carrier_id, e.amount_huf, COALESCE(e.currency, 'HUF'), e.held_at
  FROM escrow_transactions e JOIN jobs j ON j.id = e.job_id
  WHERE NULLIF(e.barion_payment_id, '') IS NOT NULL ON CONFLICT DO NOTHING;
INSERT INTO payment_sessions(payment_id, booking_id, shipper_id, carrier_id, amount_huf, created_at)
  SELECT b.barion_payment_id, b.id, b.shipper_id, r.carrier_id, COALESCE(b.connection_fee_huf, 0), b.created_at
  FROM route_bookings b JOIN carrier_routes r ON r.id = b.route_id
  WHERE NULLIF(b.barion_payment_id, '') IS NOT NULL ON CONFLICT DO NOTHING;

-- Csak véglegesen feldolgozott szolgáltatói eredmény oldja fel a védelmet.
-- A helyi lemondás / escrow 'refunded' önmagában nem banki visszatérítés.
CREATE OR REPLACE FUNCTION settle_fee_payment_session() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.processed AND NEW.event_type IN ('webhook', 'manual', 'orphan') THEN
    UPDATE payment_sessions SET
      state = CASE
        WHEN NEW.status = 'Succeeded' AND NEW.event_type = 'orphan' THEN 'needs_review'
        WHEN NEW.status = 'Succeeded' THEN 'succeeded'
        WHEN NEW.status IN ('Canceled', 'Expired') AND state NOT IN ('succeeded', 'needs_review') THEN 'closed'
        ELSE state END,
      settled_at = CASE WHEN NEW.status IN ('Succeeded', 'Canceled', 'Expired') THEN NOW() ELSE settled_at END
      WHERE payment_id = NEW.payment_id;
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS settle_fee_session ON payment_events;
CREATE TRIGGER settle_fee_session AFTER INSERT OR UPDATE ON payment_events
  FOR EACH ROW EXECUTE FUNCTION settle_fee_payment_session();
UPDATE payment_sessions s SET state = CASE
  WHEN EXISTS(SELECT 1 FROM payment_events e WHERE e.payment_id = s.payment_id AND e.processed AND e.status = 'Succeeded' AND e.event_type = 'orphan') THEN 'needs_review'
  WHEN EXISTS(SELECT 1 FROM payment_events e WHERE e.payment_id = s.payment_id AND e.processed AND e.status = 'Succeeded' AND e.event_type IN ('webhook', 'manual')) THEN 'succeeded'
  WHEN EXISTS(SELECT 1 FROM payment_events e WHERE e.payment_id = s.payment_id AND e.processed AND e.status IN ('Canceled', 'Expired') AND e.event_type = 'webhook') THEN 'closed'
  ELSE 'pending' END WHERE s.state = 'pending';
UPDATE payment_sessions SET settled_at = NOW() WHERE state <> 'pending' AND settled_at IS NULL;
