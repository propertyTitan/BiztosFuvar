-- Email-megerősítés + jelszó-visszaállítás támogatása.
--
-- A user regisztrációkor automatikusan kap egy verifikációs e-mailt;
-- a státuszt a `users.email_verified` jelzi. Egyelőre ez NEM blokkol
-- semmit (csak banner a UI-n) — későbbi launch-fázisban lehet hozzá
-- kapni a fizetés-blokkolást vagy hasonlót.
--
-- A jelszó-reset egyszer használatos hash-elt tokennel megy. A nyers
-- token csak az e-mailbe kerül; a DB-ben SHA-256 hash van. 30 perc
-- után lejár; sikeres reset után törlődik.

ALTER TABLE users
  ADD COLUMN IF NOT EXISTS email_verified                  BOOLEAN     NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS email_verification_token_hash   TEXT,
  ADD COLUMN IF NOT EXISTS email_verification_sent_at      TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS password_reset_token_hash       TEXT,
  ADD COLUMN IF NOT EXISTS password_reset_expires_at       TIMESTAMPTZ;

-- A meglévő user-eket „megerősítettnek" tekintjük, hogy ne zárjuk ki
-- őket a launch-szal. Az új regisztrációknak már a verify-flow-n kell
-- átmenniük.
UPDATE users SET email_verified = true WHERE email_verified = false;

CREATE INDEX IF NOT EXISTS idx_users_password_reset_token
  ON users(password_reset_token_hash)
  WHERE password_reset_token_hash IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_users_email_verification_token
  ON users(email_verification_token_hash)
  WHERE email_verification_token_hash IS NOT NULL;
