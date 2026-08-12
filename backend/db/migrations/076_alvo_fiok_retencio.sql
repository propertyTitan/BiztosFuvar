-- 076 — Alvó fiókok retenciója (figyelmeztetés-jelző)
--
-- ⚠️ MIÉRT (2026-08-12, USER-DÖNTÉS a 10. mérés F6 találatára): egy fiók, ami
-- évek óta nem lépett be, HATÁRIDŐ NÉLKÜL őrizte a nevet, e-mailt,
-- telefonszámot, rendszámot, profilképet és bemutatkozást. Az adatkezelési
-- tájékoztató „a fiókod élettartamáig"-ot ír — ez formálisan igaz volt, de az
-- „élettartam" a gyakorlatban végtelen. A GDPR 5. cikk (1) e) szerint a
-- személyes adat nem őrizhető korlátlanul.
--
-- A SZABÁLY (a tájékoztatóban is közölve):
--   * 3 év tétlenség (nincs bejelentkezés) után FIGYELMEZTETŐ e-mail megy,
--   * ha a következő 30 napban sem lép be, a fiók és a hozzá tartozó
--     személyes adat automatikusan törlődik.
--
-- ⚠️ A FIGYELMEZTETÉS NEM UDVARIASSÁG, HANEM A SZABÁLY RÉSZE. Előzmény nélküli
-- törlésnél a felhasználó a fuvar-előzményét, az értékeléseit és a
-- referral-kódját veszítené el anélkül, hogy bármit tehetett volna ellene.
-- Egyetlen bejelentkezés visszaállítja az órát (a mező nullázódik).
--
-- ⚠️ AMI VÉDI A TÖRLÉSTŐL: a fiók NEM törölhető, ha aktív + fizetett vagy
-- vitatott ügylete van (ugyanaz a `userHasBlockingDealings` guard, amit a
-- self-delete és az admin-törlés is használ) — különben egy alvó feladó
-- törlése MÁS emberek folyamatban lévő ügyleteit semmisítené meg.
--
-- MÉRÉS A BEVEZETÉS ELŐTT (prod, 2026-08-12): 18 fiók, ebből 2+ éve inaktív:
-- 0. A szabály tehát ma egyetlen fiókot sem érint — a jövőre szól.

ALTER TABLE users
    ADD COLUMN IF NOT EXISTS dormant_warned_at TIMESTAMPTZ;

COMMENT ON COLUMN users.dormant_warned_at IS
  'Mikor kapott a felhasználó alvó-fiók figyelmeztetést. Bejelentkezéskor nullázódik. NULL = nincs folyamatban törlési figyelmeztetés.';
