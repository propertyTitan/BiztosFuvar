-- =====================================================================
--  032_sender_emergency_code.sql
--
--  Feladói vészhelyzeti kód: ha a címzett nem elérhető, a feladó
--  is le tudja zárni a fuvart egy külön kóddal.
--  A rendszer logolja melyik kóddal zárult le (vita rendezéshez).
-- =====================================================================

ALTER TABLE jobs
    ADD COLUMN IF NOT EXISTS sender_delivery_code VARCHAR(6),
    ADD COLUMN IF NOT EXISTS closed_by_code_type  TEXT;
    -- closed_by_code_type: 'recipient' | 'sender_emergency' | NULL

COMMENT ON COLUMN jobs.sender_delivery_code IS
  'Feladó vészhelyzeti kódja — ha a címzett nem elérhető, ezzel is lezárható';
COMMENT ON COLUMN jobs.closed_by_code_type IS
  'Melyik kóddal zárult le: recipient (címzett) vagy sender_emergency (feladó vészhelyzeti)';
