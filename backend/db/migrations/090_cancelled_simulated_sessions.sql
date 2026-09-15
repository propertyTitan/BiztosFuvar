-- A helyi lemondás nem igazol banki végállapotot. Csak a 089 által
-- bizonyított szimuláció zárható le így, fizetés és sikeres jelzés nélkül.
-- A trigger az ügylet UPDATE-jének tranzakciójában, ugyanazon sorzár alatt
-- fut, mint a díjkönyvelés: hibánál a lemondás is visszagördül.
CREATE OR REPLACE FUNCTION close_cancelled_simulated_fee_sessions()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  UPDATE payment_sessions s
    SET state = 'closed', closed_reason = 'cancelled', settled_at = NOW()
    WHERE ((TG_TABLE_NAME = 'jobs' AND s.job_id = NEW.id)
        OR (TG_TABLE_NAME = 'route_bookings' AND s.booking_id = NEW.id))
      AND s.state = 'pending' AND s.is_simulated
      -- A még feldolgozatlan Succeeded is egyeztetést igényelhet.
      AND NOT EXISTS (SELECT 1 FROM payment_events e
        WHERE e.payment_id = s.payment_id AND e.status = 'Succeeded')
      AND NOT EXISTS (SELECT 1 FROM fee_payment_receipts r
        WHERE r.payment_id = s.payment_id);
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS close_cancelled_job_simulation ON jobs;
CREATE TRIGGER close_cancelled_job_simulation AFTER UPDATE OF status ON jobs
  FOR EACH ROW WHEN (NEW.status = 'cancelled' AND NEW.paid_at IS NULL)
  EXECUTE FUNCTION close_cancelled_simulated_fee_sessions();
DROP TRIGGER IF EXISTS close_cancelled_booking_simulation ON route_bookings;
CREATE TRIGGER close_cancelled_booking_simulation AFTER UPDATE OF status ON route_bookings
  FOR EACH ROW WHEN (NEW.status IN ('cancelled', 'rejected') AND NEW.paid_at IS NULL)
  EXECUTE FUNCTION close_cancelled_simulated_fee_sessions();

-- Visszamenőleges, ismételhető javítás. Az ismeretlen/valódi, fizetett és
-- egyeztetésre váró előzményeket megőrizzük; nyugta vagy számla nem készül.
UPDATE payment_sessions s
  SET state = 'closed', closed_reason = 'cancelled', settled_at = NOW()
  WHERE s.state = 'pending' AND s.is_simulated
    AND (EXISTS (SELECT 1 FROM jobs j WHERE j.id = s.job_id
           AND j.status = 'cancelled' AND j.paid_at IS NULL)
      OR EXISTS (SELECT 1 FROM route_bookings b WHERE b.id = s.booking_id
           AND b.status IN ('cancelled', 'rejected') AND b.paid_at IS NULL))
    AND NOT EXISTS (SELECT 1 FROM payment_events e
      WHERE e.payment_id = s.payment_id AND e.status = 'Succeeded')
    AND NOT EXISTS (SELECT 1 FROM fee_payment_receipts r
      WHERE r.payment_id = s.payment_id);
