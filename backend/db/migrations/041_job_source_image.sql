-- =====================================================================
--  041_job_source_image.sql — "Hozasd el" termékkép a fuvarhoz.
--
--  Ha a fuvar a "Hozasd el" folyamatból jött (IKEA/OBI/Praktiker/Jófogás
--  link), itt tároljuk a hirdetés OG-előnézeti képének URL-jét, hogy a
--  sofőr a fuvar-részletezőnél lássa MIT kell elhoznia.
--
--  Csak ismert bolti kép-CDN-ek URL-je kerülhet ide (a backend host-
--  engedélylistája szűr) — hotlink, ezért törött kép esetén a UI elrejti.
-- =====================================================================

ALTER TABLE jobs ADD COLUMN IF NOT EXISTS source_image_url TEXT;
