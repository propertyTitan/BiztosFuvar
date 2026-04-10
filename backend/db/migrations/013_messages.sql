-- In-app üzenetküldés feladó ↔ sofőr között.
--
-- Egy "beszélgetés" egy fuvarhoz (job_id) VAGY egy foglaláshoz (booking_id)
-- tartozik — nincs külön conversations tábla, mert a fuvar/foglalás
-- egyértelműen meghatározza a két felet. A frontend a conversation_key
-- param alapján szűr (pl. "job:<id>" vagy "booking:<id>").
--
-- Miért kell?
--   - A feladónak és a sofőrnek ne kelljen telefonszámot cserélniük.
--   - A platform megtartja az üzeneteket audit / dispute célokra.

CREATE TABLE IF NOT EXISTS messages (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    job_id      UUID REFERENCES jobs(id) ON DELETE CASCADE,
    booking_id  UUID REFERENCES route_bookings(id) ON DELETE CASCADE,
    sender_id   UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    body        TEXT NOT NULL,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CHECK (job_id IS NOT NULL OR booking_id IS NOT NULL)
);

CREATE INDEX IF NOT EXISTS idx_messages_job     ON messages(job_id, created_at);
CREATE INDEX IF NOT EXISTS idx_messages_booking ON messages(booking_id, created_at);
CREATE INDEX IF NOT EXISTS idx_messages_sender  ON messages(sender_id);
