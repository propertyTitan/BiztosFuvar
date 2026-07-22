-- 051: DAC7 (Aktv.) platformüzemeltetői átvilágítás — magánszemély szállítók
-- adóazonosító jele + a progresszív bekérés állapot-mezői.
--
-- A DAC7 szerint a személyi szolgáltatást (fuvarozást) végző értékesítőkről
-- adatot kell szolgáltatni a NAV-nak: név, lakcím, születési dátum,
-- adóazonosító jel. Cégeknél az adószám (tax_id, már gyűjtjük) a TIN.
-- A bekérés a Vinted-mintát követi: NEM a regisztrációnál, hanem az ELSŐ
-- teljesített fuvar után kérjük (tax_data_requested_at), 2 emlékeztető +
-- 60 nap után az új ajánlattétel blokkolódik (törvényi kikényszerítés).
ALTER TABLE users ADD COLUMN IF NOT EXISTS personal_tax_id TEXT;
ALTER TABLE users ADD COLUMN IF NOT EXISTS birth_date DATE;
ALTER TABLE users ADD COLUMN IF NOT EXISTS tax_data_requested_at TIMESTAMPTZ;
ALTER TABLE users ADD COLUMN IF NOT EXISTS tax_data_reminder_count INTEGER NOT NULL DEFAULT 0;
ALTER TABLE users ADD COLUMN IF NOT EXISTS tax_data_last_reminder_at TIMESTAMPTZ;
