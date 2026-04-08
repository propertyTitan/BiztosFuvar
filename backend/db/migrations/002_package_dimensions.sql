-- Idempotens migráció: kötelező csomag-méretek (hossz × szélesség × magasság).
-- Futtatható önállóan is, akkor is, ha már vannak meglévő fuvarok.
--
-- A mezők centiméterben tárolódnak, hogy egész szám legyen a tárolás és
-- ne legyenek lebegőpont-hibák. A felület is cm-ben kéri a usertől.
--
-- A meglévő sorok NULL-t kapnak — a backend POST /jobs validáció csak az
-- ÚJ fuvarokra teszi kötelezővé (nem teszünk NOT NULL constraintet, hogy ne
-- törjön a seed).

ALTER TABLE jobs
    ADD COLUMN IF NOT EXISTS length_cm INTEGER,
    ADD COLUMN IF NOT EXISTS width_cm  INTEGER,
    ADD COLUMN IF NOT EXISTS height_cm INTEGER;
