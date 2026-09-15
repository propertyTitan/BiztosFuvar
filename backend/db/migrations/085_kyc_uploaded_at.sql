-- A rekord létrejötte helyett az aktuális kép feltöltése indítja a retenciót.
ALTER TABLE kyc_documents ADD COLUMN IF NOT EXISTS uploaded_at TIMESTAMPTZ;
-- A korábbi upsert reviewed_at-ot frissített. Ez a rendelkezésre álló
-- legutóbbi időpont; a történeti feltöltési idő pontosan nem rekonstruálható.
UPDATE kyc_documents SET uploaded_at = COALESCE(reviewed_at, created_at) WHERE uploaded_at IS NULL;
