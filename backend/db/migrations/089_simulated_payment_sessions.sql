ALTER TABLE payment_sessions ADD COLUMN IF NOT EXISTS provider TEXT NOT NULL DEFAULT 'unknown';
ALTER TABLE payment_sessions ADD COLUMN IF NOT EXISTS is_simulated BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE payment_sessions ADD COLUMN IF NOT EXISTS closed_reason TEXT;

-- A jelenlegi CIB/QVIK adapterek csak szimulációban adnak ILYEN ID + URL
-- párt (services/cib.js, qvik.js). Mindkettő szerver által írt mező.
-- Nem az aktuális env, és nem önmagában az ID prefixe dönti el a múltat.
-- Ismeretlen/valódi formátumot konzervatívan kezelünk: a törlési őr marad.
CREATE OR REPLACE FUNCTION classify_fee_session(pid TEXT, gateway TEXT, entity_id UUID)
RETURNS TABLE(provider TEXT, is_simulated BOOLEAN) LANGUAGE sql IMMUTABLE AS $$
  SELECT COALESCE(p.name, 'unknown'), p.name IS NOT NULL
  FROM (SELECT 1) seed LEFT JOIN (VALUES ('cib'), ('qvik')) AS p(name)
    ON pid = p.name || '-stub-' || entity_id::text
   AND gateway = 'stub:' || p.name || '/' || entity_id::text
$$;

CREATE OR REPLACE FUNCTION remember_fee_payment_session() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.barion_payment_id IS NULL OR NEW.barion_payment_id = '' THEN RETURN NEW; END IF;
  IF TG_TABLE_NAME = 'escrow_transactions' THEN
    INSERT INTO payment_sessions(payment_id, job_id, shipper_id, carrier_id, amount_huf, currency, provider, is_simulated)
      SELECT NEW.barion_payment_id, j.id, j.shipper_id, j.carrier_id, NEW.amount_huf,
             COALESCE(NEW.currency, 'HUF'), c.provider, c.is_simulated
      FROM jobs j CROSS JOIN LATERAL classify_fee_session(NEW.barion_payment_id, NEW.barion_gateway_url, j.id) c
      WHERE j.id = NEW.job_id ON CONFLICT(payment_id) DO NOTHING;
  ELSE
    INSERT INTO payment_sessions(payment_id, booking_id, shipper_id, carrier_id, amount_huf, provider, is_simulated)
      SELECT NEW.barion_payment_id, NEW.id, NEW.shipper_id, r.carrier_id,
             COALESCE(NEW.connection_fee_huf, 0), c.provider, c.is_simulated
      FROM carrier_routes r CROSS JOIN LATERAL classify_fee_session(NEW.barion_payment_id, NEW.barion_gateway_url, NEW.id) c
      WHERE r.id = NEW.route_id ON CONFLICT(payment_id) DO NOTHING;
  END IF;
  RETURN NEW;
END $$;

-- Meglévő soroknál is csak a fennmaradt, pontosan egyező két mező bizonyít.
UPDATE payment_sessions s SET provider = c.provider, is_simulated = c.is_simulated
  FROM escrow_transactions e CROSS JOIN LATERAL classify_fee_session(e.barion_payment_id, e.barion_gateway_url, e.job_id) c
  WHERE s.payment_id = e.barion_payment_id AND s.job_id = e.job_id AND s.provider = 'unknown' AND c.is_simulated;
UPDATE payment_sessions s SET provider = c.provider, is_simulated = c.is_simulated
  FROM route_bookings b CROSS JOIN LATERAL classify_fee_session(b.barion_payment_id, b.barion_gateway_url, b.id) c
  WHERE s.payment_id = b.barion_payment_id AND s.booking_id = b.id AND s.provider = 'unknown' AND c.is_simulated;

-- A már kuponnal rendezett, beragadt TESZT-ügyletek javítása. Ez nem banki
-- teljesítés: nem írunk payment_eventet, nyugtát vagy számlát.
UPDATE payment_sessions s SET state = 'closed', closed_reason = 'voucher', settled_at = NOW()
  FROM jobs j WHERE s.job_id = j.id AND s.state = 'pending' AND s.is_simulated
    AND j.paid_at IS NOT NULL AND j.connection_fee_huf = 0
    AND EXISTS(SELECT 1 FROM fee_vouchers v WHERE v.used_on_job = j.id AND v.used_at IS NOT NULL)
    AND NOT EXISTS(SELECT 1 FROM payment_events e WHERE e.payment_id = s.payment_id AND e.processed AND e.status = 'Succeeded')
    AND NOT EXISTS(SELECT 1 FROM fee_payment_receipts r WHERE r.payment_id = s.payment_id);
