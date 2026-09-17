-- A címzetti küldési feladat a felvétellel együtt commitol. A sor csak
-- hivatkozást tartalmaz; az ügylet törlése a feladatot is törli.
CREATE TABLE IF NOT EXISTS pickup_notification_queue (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  job_id uuid REFERENCES jobs(id) ON DELETE CASCADE,
  booking_id uuid REFERENCES route_bookings(id) ON DELETE CASCADE,
  channel text NOT NULL CHECK (channel IN ('sms', 'email')),
  attempts integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT NOW(),
  next_attempt_at timestamptz NOT NULL DEFAULT NOW(),
  CHECK ((job_id IS NOT NULL)::integer + (booking_id IS NOT NULL)::integer = 1),
  UNIQUE (job_id, channel),
  UNIQUE (booking_id, channel)
);
CREATE INDEX IF NOT EXISTS pickup_notification_queue_due_idx ON pickup_notification_queue(next_attempt_at);
