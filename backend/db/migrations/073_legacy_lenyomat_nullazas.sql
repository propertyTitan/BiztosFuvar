-- 073 — A sózatlan (sha256-legacy) okmány-lenyomatok kinullázása
--
-- ⚠️ MIÉRT: a 064-es migráció bevezette a HMAC-elt lenyomatot, de a MÁR
-- MEGLÉVŐ sorokat nem tudta átszámolni — a nyers okmányszámot sosem tároltuk,
-- tehát nincs miből. Ezek a sorok `hash_algo = 'sha256-legacy'` jelölést
-- kaptak, és a launch-kapu listára került, hogy élesedés előtt rendezni kell.
--
-- A PROBLÉMA: a magyar személyi igazolvány számának értéktere teljesen
-- felsorolható (~10^8). Egy SÓZATLAN SHA-256 ezen a téren nem egyirányú
-- függvény, hanem lassított keresés: néhány perc alatt visszafejthető.
-- Közben HÁROM dokumentum állítja az ellenkezőjét:
--
--   * adatkezelési tájékoztató: „ebből az okmányszám nem állítható vissza"
--   * GDPR 30. cikk nyilvántartás
--   * érdekmérlegelési teszt II. (a lenyomat 5 éves megőrzését erre alapozza)
--
-- Vagyis nem elméleti kockázatról van szó: a publikált állításunk nem volt
-- igaz ezekre a sorokra.
--
-- MIT MÉRTEM MEG A PRODON, MIELŐTT TÖRÖLTEM (2026-08-11):
--   kyc_documents:    7 sor, mind 'sha256-legacy', mind 'approved'
--   kyc_doc_history:  7 sor, mind 'sha256-legacy'
--   deleted_account_count ÖSSZESEN: 0
--
-- Az utolsó szám a legfontosabb: ezekkel az okmányokkal MÉG SENKI nem törölt
-- fiókot, tehát a „visszatérő törölt fiók" védelem semmi valósat nem veszít.
--
-- MI VÉSZ EL: a 7 (pre-launch) fiókra az „egy okmány = egy fiók" duplikátum-
-- védelem. Ha egyikük ma új fiókot nyitna ugyanazzal a személyivel, azt nem
-- fognánk meg. Ez vállalható ár azért, hogy a publikált állításunk igaz legyen.
--
-- ÖNGYÓGYULÁS: ha ezek a felhasználók valaha újra feltöltik az okmányukat
-- (lejárat, újra-hitelesítés), a HMAC kiszámolódik és tárolódik — a védelem
-- egyénenként visszaáll. Minden ÚJ feltöltés eleve HMAC-elt.
--
-- ⚠️ A `hash_algo`-t is nullázzuk, nem hagyjuk 'sha256-legacy'-n: különben a
-- séma azt sugallná, hogy van még legacy adatunk, holott a mező üres.

UPDATE kyc_documents
   SET doc_number_hash = NULL,
       hash_algo       = NULL
 WHERE hash_algo = 'sha256-legacy';

-- A history-sor CSAK a lenyomatból áll (az a kulcsa), ezért NULL-ozni nem
-- lehet — a sort magát visszük el. A `deleted_account_count = 0` miatt nincs
-- benne olyan információ, ami külön megőrzendő lenne.
DELETE FROM kyc_doc_history
 WHERE hash_algo = 'sha256-legacy';
