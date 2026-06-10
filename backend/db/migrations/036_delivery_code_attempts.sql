-- Átvételi kód brute-force védelem: próbálkozás-számláló + zárolás.
-- Hibás kód esetén nő a számláló; 5 hibás próba után a fuvar kód-ellenőrzése
-- 1 órára zárolódik. Sikeres kódnál a számláló nullázódik.
ALTER TABLE jobs ADD COLUMN IF NOT EXISTS delivery_code_attempts INT NOT NULL DEFAULT 0;
ALTER TABLE jobs ADD COLUMN IF NOT EXISTS delivery_code_locked_until TIMESTAMPTZ;
