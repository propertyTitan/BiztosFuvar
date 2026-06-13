-- =====================================================================
--  039_kyc_file_url_nullable.sql — KYC nyers fotó törölhetősége.
--
--  Adatminimalizálás: a végleges döntés után a KYC-okmány nyers fotóját
--  töröljük a tárolóból, és a file_url-t NULL-ra állítjuk (= "kiürítve").
--  A metaadat (státusz, doc_number_hash) megmarad a csalásvédelemhez.
--  Ehhez a file_url oszlopnak engednie kell a NULL-t.
-- =====================================================================

ALTER TABLE kyc_documents ALTER COLUMN file_url DROP NOT NULL;
