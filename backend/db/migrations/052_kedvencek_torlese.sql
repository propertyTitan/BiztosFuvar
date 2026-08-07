-- =====================================================================
--  052_kedvencek_torlese.sql — a „kedvenc szállítók" funkció kivezetése
--
--  User-döntés (2026-08-07): „a kedvencek funkciót töröljük."
--
--  Előzmény: a 031-es migráció létrehozta a `favorite_drivers` táblát, és
--  megszületett a `src/routes/favorites.js` is — de a routert SOHA nem
--  kötötték be az `index.js`-be, és a frontend sem hívta. A funkció tehát
--  egyetlen napig sem élt: halott kód volt, ami élő funkciónak látszott a
--  kódtérképen. A 2026-08-07-i szerep-lefedettségi mérés bukkant rá.
--
--  BIZTONSÁGOS: a törlés előtt ellenőrizve, hogy az éles táblában 0 sor van
--  — és nem is keletkezhetett adat, mert a végpontok elérhetetlenek voltak.
-- =====================================================================

DROP TABLE IF EXISTS favorite_drivers;
