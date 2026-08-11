-- 071 — Halott séma, harmadik kör
--
-- A 066 és a 070 migráció ezt az osztályt célozta, de KÉZI listával — ezért
-- talált a következő független mérés megint újat. Ami most megy:
--
--   invoices.pdf_url            → 0 sor, NULLA kód-hivatkozás
--   photos.ai_raw_response      → 0 sor, az INSERT fixen NULL-t ír
--   photos.ai_confidence        → 0 sor, ugyanaz
--   photos.ai_has_cargo         → 0 sor, ugyanaz (a web egy halott ágat rajzolt rá)
--   escrow_transactions.notes   → 0 sor, NULLA hivatkozás
--
-- ⚠️ A LEGKOCKÁZATOSABBAK:
--   * `invoices.pdf_url` — FÁJL-URL oszlop. Pontosan az, amit a 070 a
--     `reviews.photo_url`-nél „azonnali árva-gyár"-ként törölt: ha egy
--     jövőbeli Számlázz.hu-PDF-mentés némán ide írna, sem a `userFiles.js`
--     gyűjtői, sem a `retention.js` nem tudna róla.
--   * `photos.ai_raw_response` — a NYERS AI-válasz egy lakás/csomag fotójáról.
--     A lehető legbeszédesebb tartalom, séma-szinten „meglévőnek" látszik.
--
-- MIND A PRODON ELLENŐRIZVE A TÖRLÉS ELŐTT: 0 kitöltött sor mindegyikben.

ALTER TABLE invoices              DROP COLUMN IF EXISTS pdf_url;
ALTER TABLE photos                DROP COLUMN IF EXISTS ai_raw_response;
ALTER TABLE photos                DROP COLUMN IF EXISTS ai_confidence;
ALTER TABLE photos                DROP COLUMN IF EXISTS ai_has_cargo;
ALTER TABLE escrow_transactions   DROP COLUMN IF EXISTS notes;
