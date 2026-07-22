# Adatvédelmi hatásvizsgálat (DPIA) — AI-támogatott okmány-azonosítás

**Adatkezelő:** Tiszta Hód Kft. (GoFuvar platform, gofuvar.hu)
**Verzió:** 1.0 (munkapéldány) · **Kelt:** 2026-07-20
**Készítette:** AI-asszisztens a platform tényleges működése alapján;
jóváhagyja: Jovány Gyula ügyvezető
**Jogalap a hatásvizsgálatra:** GDPR 35. cikk

## 1. Miért készül hatásvizsgálat

A GDPR 35. cikk (1) szerint hatásvizsgálat szükséges, ha az adatkezelés —
különösen új technológiát alkalmazva — valószínűsíthetően magas
kockázattal jár. A NAIH által közzétett, kötelező DPIA-eseteket felsoroló
jegyzék szempontjai közül az adatkezelést kettő érinti:

1. **Innovatív technológia alkalmazása**: a feltöltött személyazonosító
   okmányt mesterséges intelligencia (Google Gemini nagy nyelvi modell)
   elemzi;
2. **Értékelés / pontozás-jellegű elem**: az AI az okmány
   érvényesség-jellegéről, olvashatóságáról és az életkorról ad
   előzetes megállapítást.

Elővigyázatosságból a hatásvizsgálatot elvégezzük akkor is, ha a
kötelezettség vitatható lenne. **Felülvizsgálati kötelezettség:** az élő
GPS-helymeghatározás (mobil-fázis) élesítése ELŐTT új, kiegészítő DPIA
készítendő (helymeghatározási adatok szisztematikus kezelése).

## 2. Az adatkezelés szisztematikus leírása

### 2.1 Cél és kontextus

A Szállítóként tevékenykedni kívánó felhasználó személyazonosságának
távoli megállapítása (részletes cél- és jogalap-elemzés: lásd
[erdekmerlegelesi-tesztek.md](erdekmerlegelesi-tesztek.md) I. teszt).
2026-07-19-től kizárólag a szállítói tevékenységhez kötelező; Feladótól
csak kockázati alapon kérhető.

### 2.2 Adatfolyam (lépésről lépésre)

1. A felhasználó a profilján feltölti a személyi igazolvány két oldalának
   fényképét (HTTPS; a fájl tartalmi/magic-byte ellenőrzésen esik át —
   csak valódi képformátum fogadott).
2. A kép **privát object storage-ba** kerül (Cloudflare R2, dedikált
   privát bucket, nyilvános URL nélkül); a DB csak a kulcsot tárolja.
3. A kép egy példánya API-hívásban a **Google Gemini** szolgáltatáshoz
   kerül elemzésre (EU-n kívüli továbbítás — garanciák: 5.2 pont).
   Az AI kimenete: okmány-jelleg (valódinak tűnik-e), olvashatóság,
   kiolvasott név és születési dátum, 18+ ellenőrzés eredménye.
4. **Emberi adminisztrátor** a képet (rövid élettartamú, aláírt
   hivatkozáson át) és az AI-előszűrés eredményét látva dönt:
   jóváhagyás / elutasítás (indoklással, amelyről az érintett értesítést
   kap).
5. A döntés után **30 nappal a nyers fotó automatikusan, véglegesen
   törlődik** (napi ütemezett job); megmarad: státusz, a döntés ténye,
   valamint az okmányszám vissza nem fejthető lenyomata
   (`doc_number_hash`).
6. Az érintett a státuszát a profilján látja; elutasításnál újra
   próbálkozhat.

### 2.3 Érintettek és adatkategóriák

- **Érintettek**: szállítói tevékenységre jelentkező felhasználók
  (18+ természetes személyek); kockázati alapon egyes feladók.
- **Adatok**: az okmány két oldalán látható adatok (név, születési hely
  és idő, okmányszám, arckép, aláírás, érvényesség). **Lakcímkártya
  kizárt** (személyi azonosítót a platform semmilyen formában nem kezel).
- **Nem különleges adat**: biometrikus sablon-képzés, arc-egyeztetés
  nincs (GDPR (51) preambulum); egészségügyi vagy egyéb 9. cikkes adat
  az okmányon nem szerepel.

### 2.4 Címzettek, adatfeldolgozók

| Szereplő | Szerep | Hely |
|---|---|---|
| Cloudflare R2 | privát tárolás | EU régió |
| Google LLC (Gemini API) | AI-előellenőrzés | EU-n kívüli továbbítás lehetséges (SCC) |
| Railway (backend-hoszting) | feldolgozás-futtatás | EU régió |
| Neon (PostgreSQL) | metaadat-tárolás | AWS eu-central-1 (Frankfurt) |
| Adminisztrátor (adatkezelő munkatársa) | döntéshozatal | HU |

## 3. Szükségesség és arányosság

Az érdekmérlegelési teszt (I.) részletesen vizsgálja; összefoglalva: a
távoli kontextusban az okmányfotó az azonosítás egyetlen működőképes
eszköze; az AI-előszűrés az emberi döntés minőségét és gyorsaságát
szolgálja (nem helyettesíti); a megőrzés a szükséges minimumra (30 nap +
lenyomat) korlátozott; a kötelezettség a kockázatot ténylegesen hordozó
szerepkörre (szállító) szűkített.

## 4. Kockázatok azonosítása és értékelése

Skála: valószínűség/súlyosság — alacsony (A), közepes (K), magas (M).

| # | Kockázat | Val. | Súly. | Kezelés | Maradék |
|---|---|---|---|---|---|
| 1 | Jogosulatlan hozzáférés a tárolt okmányfotókhoz (adatlopás) | A | M | Privát bucket, nincs publikus URL, rövid élettartamú aláírt linkek, admin-jog + force-logout mechanizmus, 30 napos tárolás (kis támadási felület), CI-őrzött adatszivárgás-tesztek | A |
| 2 | A Google a beküldött okmányképet saját (modellfejlesztési) célra használja | A* | M | *CSAK az ingyenes API-szinten állna fenn — 2026-07-22-én ELLENŐRIZVE: a Google Cloud Console Billing havonta változó, valódi díjat mutat, ami kizárólag számlázás-engedélyezett (fizetős) projektnél lehetséges; ott a beküldött tartalom nem használható fejlesztésre | A |
| 3 | Téves AI-kiolvasás → jogosulatlan elutasítás vagy téves életkor-megállapítás | K | K | Az AI csak előszűr; minden döntés emberi; elutasítás indoklással + újrapróbálkozás lehetősége; panasz-csatorna (panasz@gofuvar.hu) | A |
| 4 | Túltárolás (a törlés elmarad) | A | M | Automatizált napi törlő-job (kézi lépés nincs); a retenció-logika automata teszttel fedett | A |
| 5 | Funkció-elcsúszás (az okmányadatok más célra használata) | A | K | Célhoz kötöttség a tájékoztatóban; a kód az okmányadatot kizárólag a KYC-folyamatban használja; új cél = új jogalap + e DPIA felülvizsgálata | A |
| 6 | Lakcímkártya/személyi azonosító véletlen begyűjtése | A | M | A felület kizárólag személyi igazolványt kér; szabály rögzítve (CLAUDE.md + jelen dokumentum): lakcímkártya SOHA; ha felhasználó tévedésből mégis azt tölt fel, az admin elutasítja és a fotó a szokásos rend szerint törlődik | A |
| 7 | Az EU-n kívüli továbbítás garanciáinak elégtelensége | A | K | Google adatfeldolgozási feltételek + EU szerződéses általános adatvédelmi kikötések (SCC); adattakarékosság (csak a két okmánykép megy át, tárolás a Google-nál a fizetős szinten nincs) | A |
| 8 | Megkülönböztetés (pl. nem magyar okmányok rosszabb felismerése) | K | A | A döntés emberi; elutasításnál egyedi felülvizsgálat kérhető; a panasz-csatorna nyitva | A |

## 5. Kockázatcsökkentő intézkedések

### 5.1 Már megvalósult

- Privát tároló + aláírt, rövid élettartamú hozzáférési linkek
- 30 napos automatikus törlés (napi job), lenyomat-alapú megőrzés
- Emberi döntéshozatal (22. cikk szerinti tisztán automatizált döntés
  nincs); elutasítás indoklással
- Magic-byte fájl-ellenőrzés; HTTPS mindenhol; rate-limit
- Munkamenet-érvénytelenítés (kompromittált admin-fiók kizárható)
- Sentry hibafigyelés PII-szűréssel (auth-fejlécek eltávolítva)
- Átlátható adatkezelési tájékoztató (adatkör, cél, megőrzés, címzettek,
  automatizált előellenőrzés ténye külön kiemelve)

### 5.2 Kötelező teendők az élesítés előtt/során

1. ~~Gemini API számlázás-engedélyezett (fizetős) szint ellenőrzése~~ →
   **KÉSZ (2026-07-22)**, lásd 2. kockázat.
2. Az érdekmérlegelési tesztek és e DPIA **ügyvezetői jóváhagyása**.
3. A tervezett **ügyvédi review** kiterjesztése e dokumentumokra.

### 5.3 Tervezett felülvizsgálatok

- **Élő GPS (mobil-fázis) előtt**: kiegészítő DPIA a helyadatokra.
- **eID/eIDAS azonosítás elérhetővé válásakor**: az okmányfotós módszer
  szükségességének újraértékelése.
- Évente egyszer, vagy lényeges változáskor: e dokumentum átnézése.

## 6. Következtetés

Az azonosított kockázatok a felsorolt intézkedésekkel **alacsony maradék
kockázati szintre** szoríthatók; a 35. cikk (7) szerinti szempontok
(rendszerezett leírás, szükségesség-arányosság, kockázatok, intézkedések)
teljesülnek. A GDPR 36. cikk szerinti **előzetes NAIH-konzultáció nem
szükséges**, mert magas maradék kockázat nem áll fenn — a 2. kockázat
egyetlen feltétele (fizetős Gemini-szint) 2026-07-22-én igazoltan
teljesül. Ha ez a jövőben megváltozna (pl. a kulcs új, számlázás nélküli
projektre kerülne), a Gemini-előszűrést azonnal fel kell függeszteni (a
KYC tisztán kézi jóváhagyással is működőképes).

```
Kelt: Hódmezővásárhely, 2026. ___________

________________________________
Jovány Gyula, ügyvezető
Tiszta Hód Kft.
```
