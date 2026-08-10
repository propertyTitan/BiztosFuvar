-- 065 — A retenciós őr által feltárt hiányok
--
-- Ezt a migrációt nem kézi átolvasás szülte, hanem az ÚJ RETENCIÓS ŐR
-- (tests/retencios-or.test.js): az a séma minden tábláját a manifesthez méri,
-- és megnevezte, mi maradt ki. Három audit-kör talált egymás után „lefedetlen
-- tábla" találatot — ez a migráció + az őr együtt zárja le a hibaosztályt.

-- ── 1. HALOTT TÁBLA ──────────────────────────────────────────────────
-- A `weekly_challenges` a gamification korai fejlesztéséből maradt: a teljes
-- kódbázisban NULLA hivatkozás van rá, és a prod táblában 0 sor. Egy
-- user_id-t hordozó tábla, amiről senki nem tud — pont az a fajta séma, ami
-- egy jövőbeli feature-nél „meglévőnek" látszik, és némán megtelik.
-- (Ugyanaz a döntés, mint az 052-nél a `favorite_drivers`-nél.)
DROP TABLE IF EXISTS weekly_challenges;

-- ── 2. DAC7-ADAT MEGŐRZÉSI IDEJE ─────────────────────────────────────
-- A tájékoztató (2026-08-10 óta) konkrét 5 éves megőrzést ígér az
-- adóazonosító jelre és a születési dátumra — végrehajtó kód viszont nem
-- volt hozzá. Ehhez tudni kell, MIKORTÓL számoljuk: a megadás időpontjától.
ALTER TABLE users
    ADD COLUMN IF NOT EXISTS tax_data_provided_at TIMESTAMPTZ;

-- A meglévő (jelenleg: nulla) kitöltött soroknál a legutóbbi módosítás az
-- ismert legjobb közelítés.
UPDATE users
   SET tax_data_provided_at = COALESCE(updated_at, created_at)
 WHERE tax_data_provided_at IS NULL
   AND (personal_tax_id IS NOT NULL OR birth_date IS NOT NULL);

CREATE INDEX IF NOT EXISTS idx_users_tax_data_provided
    ON users (tax_data_provided_at)
    WHERE personal_tax_id IS NOT NULL OR birth_date IS NOT NULL;

-- ── 3. FIZETÉSI NAPLÓ ────────────────────────────────────────────────
-- A `payment_events` a napi körök egyikébe sem tartozott.
CREATE INDEX IF NOT EXISTS idx_payment_events_created_at
    ON payment_events (created_at);
