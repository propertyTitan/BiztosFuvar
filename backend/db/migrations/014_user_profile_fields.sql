-- Profil bővítés: avatar fotó és rövid bemutatkozás.
ALTER TABLE users
    ADD COLUMN IF NOT EXISTS avatar_url TEXT,
    ADD COLUMN IF NOT EXISTS bio TEXT;
