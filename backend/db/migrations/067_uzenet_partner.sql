-- 067 — Az üzenetek partner-mezője (a chat-előzmény teljes lezárása)
--
-- HIBA (2026-08-10, adatáramlási audit): a szállító-csere (díjmentes
-- újraválasztás) után az ÚJ szállító megkapta a fuvar teljes chat-előzményét.
--
-- Az első javítás félkész lett: a lekérdezés a JELENLEGI felekre szűrt
-- (`sender_id = ANY([shipper_id, aktuális carrier_id])`), ami elrejti a
-- LEVÁLTOTT szállító üzeneteit — de a FELADÓ üzeneteit nem, holott azokat a
-- feladó a korábbi szállítónak írta („a kapukód 1234", „a nagymamám egyedül
-- lesz otthon"). A hozzá írt teszt is csak a szállító üzenetét vizsgálta,
-- ezért zöld lett a fél védelem mellett.
--
-- A GYÖKÉR-OK: a `messages` sorból nem derül ki, KINEK szólt az üzenet — csak
-- az, ki küldte és melyik fuvarhoz tartozik. Egy beszélgetés viszont mindig
-- KÉT fél között zajlik. Enélkül minden szűrés csak közelítés marad.
--
-- MEGOLDÁS: a küldéskor rögzítjük a CÍMZETTET is. A lekérdezés így pontosan
-- azt adja vissza, aminek a felhasználó részese volt — a szállító-cserétől
-- függetlenül, és visszamenőleg is helyesen.

ALTER TABLE messages
    ADD COLUMN IF NOT EXISTS recipient_id UUID REFERENCES users(id) ON DELETE SET NULL;

-- ⚠️ A VISSZATÖLTÉS KÜLÖN FÁJLBAN (068). A migrációs futtató a TELJES fájlt
-- EGYETLEN lekérdezésként adja át (`client.query(sql)`), amiben a Postgres az
-- összes utasítást előre elemzi — így egy most létrehozott oszlopra hivatkozó
-- UPDATE nem oldható fel, és az egész fájl visszagördül. A DDL-t és a rá
-- épülő DML-t (és a rá épülő INDEXET) ezért külön migrációba tesszük.
