-- Push notification tokenek (Expo Push).
-- Egy usernek több eszköze is lehet (telefon + tablet), ezért a token
-- szintű tárolásnál nem UNIQUE a user-re, hanem a token-re.
CREATE TABLE IF NOT EXISTS push_tokens (
    id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id    UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    token      TEXT NOT NULL UNIQUE,
    platform   TEXT DEFAULT 'ios',
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_push_tokens_user ON push_tokens(user_id);
