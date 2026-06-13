-- =====================================================================
--  038_job_source_store.sql — A fuvar forrás-boltja (Hozasd el).
--
--  Ha a fuvar a "Hozasd el" folyamatból jött (IKEA/OBI/Praktiker/Jófogás
--  link), itt jelöljük a forrást, hogy a sofőröknél megjelenhessen egy
--  "🛍️ Bolti átvétel" jelvény (tiszta, csomagolt áru, ismert átvételi pont).
-- =====================================================================

ALTER TABLE jobs ADD COLUMN IF NOT EXISTS source_store TEXT;
