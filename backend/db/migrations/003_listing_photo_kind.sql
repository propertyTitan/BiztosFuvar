-- Idempotens migráció: a 'listing' típus hozzáadása a photo_kind enum-hoz.
-- A 'listing' azokra a fotókra vonatkozik, amelyeket a FELADÓ tölt fel új
-- fuvar feladásakor a hirdetéshez (pl. a lakásban lévő bútorok, dobozok).
--
-- Megjegyzés: az ALTER TYPE ... ADD VALUE nem futhat TRANSACTION blokkban,
-- ezért fontos, hogy a migrate.js single-statement-ként futtassa ezt a fájlt
-- (nem pedig BEGIN/COMMIT-be csomagolva).

ALTER TYPE photo_kind ADD VALUE IF NOT EXISTS 'listing';
