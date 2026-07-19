-- 050: NAV adószám-ellenőrzés ("Ellenőrzött cég" jelvény) audit-mezői.
--
-- A company_verification_status (dormant a PR #57 óta) kapja az eredményt
-- ('verified' ha a NAV szerint az adószám létezik + érvényes ÉS a cégnév
-- egyezik) — az admin kézi jóváhagyás továbbra is működik felette.
-- Ezek a mezők a NAV-lekérdezés nyers eredményét naplózzák:
--   nav_taxpayer_checked_at — mikor futott utoljára a NAV-ellenőrzés
--   nav_taxpayer_name       — a NAV szerinti hivatalos cégnév
--   nav_taxpayer_valid      — a NAV szerint érvényes-e az adószám
ALTER TABLE users ADD COLUMN IF NOT EXISTS nav_taxpayer_checked_at TIMESTAMPTZ;
ALTER TABLE users ADD COLUMN IF NOT EXISTS nav_taxpayer_name TEXT;
ALTER TABLE users ADD COLUMN IF NOT EXISTS nav_taxpayer_valid BOOLEAN;
