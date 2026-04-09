-- Idempotens migráció: 6 számjegyű átvételi kód minden fuvarhoz.
--
-- A kód a fuvar feladásakor generálódik, és CSAK a feladó látja.
-- Az átadáskor a feladó (vagy az átvevő címzett) megmondja a kódot a
-- sofőrnek, és a sofőr ezt beírja a "Fuvar lezárása" képernyőn.
-- Ez váltja ki a korábbi 50 m-es GPS szigorú validációt — az új modellben
-- a GPS csak logolódik (bizonyíték vita esetén), nem blokkoló.
--
-- A meglévő fuvarok NULL-t kapnak, azoknál a dropoff validáció továbbra
-- is a régi módon megy (pl. nincs delivery_code → a backend generál egyet
-- a next update-kor, vagy a sofőr simán a fotó+GPS alapján zár le).

ALTER TABLE jobs
    ADD COLUMN IF NOT EXISTS delivery_code VARCHAR(6);
