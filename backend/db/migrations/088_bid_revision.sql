-- A kliens a látott ajánlatra mond igent, nem az időközben átírt sorra.
ALTER TABLE bids ADD COLUMN IF NOT EXISTS revision INTEGER NOT NULL DEFAULT 1;

CREATE OR REPLACE FUNCTION advance_bid_revision() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  NEW.revision := OLD.revision + 1;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS advance_bid_revision ON bids;
CREATE TRIGGER advance_bid_revision BEFORE UPDATE ON bids
  FOR EACH ROW EXECUTE FUNCTION advance_bid_revision();
