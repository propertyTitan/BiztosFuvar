CREATE TABLE IF NOT EXISTS file_deletion_queue (
  key_hash TEXT PRIMARY KEY,
  file_key TEXT NOT NULL,
  batch_id UUID NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  attempts INTEGER NOT NULL DEFAULT 0,
  next_attempt_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS file_deletion_queue_due ON file_deletion_queue(next_attempt_at);
CREATE INDEX IF NOT EXISTS file_deletion_queue_batch ON file_deletion_queue(batch_id);
