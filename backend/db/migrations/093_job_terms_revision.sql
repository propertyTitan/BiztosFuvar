-- Az ajánlat a szállító által látott munkafeltételekre szól.
ALTER TABLE jobs ADD COLUMN IF NOT EXISTS terms_revision INTEGER NOT NULL DEFAULT 1;
ALTER TABLE bids ADD COLUMN IF NOT EXISTS job_terms_revision INTEGER NOT NULL DEFAULT 0;

-- Migráció előtti ajánlathoz nincs bizonyítható feltételverzió. Az ár és
-- státusz megmarad; a nyitott vagy később újranyitott ajánlatot egyszer újra
-- meg kell erősíteni. A már elfogadott megállapodás teljesítése változatlan.
ALTER TABLE bids ALTER COLUMN job_terms_revision SET DEFAULT 1;

CREATE OR REPLACE FUNCTION advance_job_terms_revision() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF ROW(NEW.title, NEW.description, NEW.pickup_address, NEW.pickup_lat, NEW.pickup_lng,
         NEW.dropoff_address, NEW.dropoff_lat, NEW.dropoff_lng, NEW.weight_kg, NEW.volume_m3,
         NEW.length_cm, NEW.width_cm, NEW.height_cm, NEW.pickup_window_start, NEW.pickup_window_end,
         NEW.pickup_needs_carrying, NEW.pickup_floor, NEW.pickup_has_elevator,
         NEW.dropoff_needs_carrying, NEW.dropoff_floor, NEW.dropoff_has_elevator,
         NEW.declared_value_huf, NEW.currency)
     IS DISTINCT FROM
     ROW(OLD.title, OLD.description, OLD.pickup_address, OLD.pickup_lat, OLD.pickup_lng,
         OLD.dropoff_address, OLD.dropoff_lat, OLD.dropoff_lng, OLD.weight_kg, OLD.volume_m3,
         OLD.length_cm, OLD.width_cm, OLD.height_cm, OLD.pickup_window_start, OLD.pickup_window_end,
         OLD.pickup_needs_carrying, OLD.pickup_floor, OLD.pickup_has_elevator,
         OLD.dropoff_needs_carrying, OLD.dropoff_floor, OLD.dropoff_has_elevator,
         OLD.declared_value_huf, OLD.currency) THEN
    NEW.terms_revision := OLD.terms_revision + 1;
  ELSE
    NEW.terms_revision := OLD.terms_revision;
  END IF;
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS advance_job_terms_revision ON jobs;
CREATE TRIGGER advance_job_terms_revision BEFORE UPDATE ON jobs
  FOR EACH ROW EXECUTE FUNCTION advance_job_terms_revision();
