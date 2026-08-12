-- 075 — Függő okmány-lenyomat (a duplikátum-gyanús feltöltéshez)
--
-- ⚠️ MIT JAVÍT (2026-08-11, 10. mérés F5): a KYC-feltöltés kommentje szó
-- szerint ezt állítja:
--
--     „A lenyomat majd akkor kerül be, ha az admin jóváhagyja — akkorra a
--      másik fiók ügye rendezve van."
--
-- Ez SOSEM történt meg. A jóváhagyás (admin.js) csak a `status`,
-- `reviewed_by`, `reviewed_at` és `rejection_reason` mezőket írja; a
-- `doc_number_hash` NULL maradt. A nyers okmányszám pedig akkorra már nincs
-- meg (nem tároljuk — épp ez a lényeg), tehát utólag nem is számolható újra.
--
-- KÖVETKEZMÉNY: aki EGYSZER duplikátum-gyanúba került, arra az
-- „egy okmány = egy fiók" DB-szintű védelem VÉGLEG elveszett. Ez azért számít
-- adatvédelmileg is, mert az érdekmérlegelési teszt II. és az adatkezelési
-- tájékoztató ÉPP EZZEL a védelemmel indokolja a lenyomat 5 éves megőrzését.
-- Ha a védelem nem működik, a megőrzés jogalapja gyengébb, mint amit írásba
-- adtunk.
--
-- MIÉRT KÜLÖN OSZLOP: a `doc_number_hash`-en PARCIÁLIS UNIQUE index van
-- (approved/pending) — ez maga a garancia. Ha a duplikátum-gyanús feltöltésnél
-- oda írnánk, az INSERT elhasalna, és a felhasználó fotója árván maradna.
-- A `pending_doc_number_hash` NEM része az indexnek: tárolja a lenyomatot,
-- de nem ütközik. Az admin jóváhagyásakor „előlép" az éles oszlopba — és ha
-- ott ütközik, azt az admin LÁTJA (a másik fiókot előbb rendeznie kell).

ALTER TABLE kyc_documents
    ADD COLUMN IF NOT EXISTS pending_doc_number_hash TEXT;

COMMENT ON COLUMN kyc_documents.pending_doc_number_hash IS
  'Duplikátum-gyanús feltöltésnél ide kerül a HMAC-lenyomat, hogy ne ütközzön a parciális UNIQUE indexszel. Az admin jóváhagyásakor előlép a doc_number_hash-be.';
