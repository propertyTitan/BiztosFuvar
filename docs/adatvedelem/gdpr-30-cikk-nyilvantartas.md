# Adatkezelési tevékenységek nyilvántartása (GDPR 30. cikk)

**Adatkezelő:** Tiszta Hód Kft. · 6800 Hódmezővásárhely, Szántó Kovács
János utca 144. · Cg. 06-09-020646 · adószám: 24750792-2-06 ·
képviseli: Jovány Gyula ügyvezető · info@gofuvar.hu · +36 20 397 9223
**Adatvédelmi tisztviselő:** nincs (a 37. cikk szerinti kötelező esetek
nem állnak fenn; felülvizsgálat az élő GPS élesítésekor)
**Verzió:** 1.0 (munkapéldány) · **Kelt:** 2026-07-20

> A 30. cikk (5) szerinti mentesség az adatkezelőre NEM alkalmazható,
> mert az adatkezelés nem alkalmi jellegű (a platform működésének
> lényege), ezért e nyilvántartás vezetése kötelező. A nyilvántartást
> minden új adatkezelési tevékenység bevezetésekor frissíteni kell.

**Rövidítések** — Jogalapok: SZERZ = szerződés teljesítése (6. cikk (1) b);
JK = jogi kötelezettség (6. cikk (1) c); JÉ = jogos érdek (6. cikk (1) f,
dokumentált érdekmérlegeléssel — lásd erdekmerlegelesi-tesztek.md);
HJ = hozzájárulás (6. cikk (1) a). TOM = technikai és szervezési
intézkedések (közös lista a dokumentum végén).

---

## 1. Fiók-regisztráció és fiókkezelés

- **Cél**: felhasználói fiók létrehozása, azonosítás a platformon,
  kapcsolattartás
- **Jogalap**: SZERZ (ÁSZF)
- **Érintettek**: regisztrált felhasználók (feladók, szállítók)
- **Adatkategóriák**: név, e-mail (megerősítéssel), telefonszám, jelszó
  (visszafejthetetlen hash), fiók-beállítások; céges fióknál cégnév,
  adószám, székhely/számlázási cím
- **Címzettek/feldolgozók**: Railway (backend, EU), Neon (adatbázis,
  Frankfurt), Resend (tranzakciós e-mail, EU)
- **Harmadik országba továbbítás**: nincs
- **Törlés**: a fiók törlésével (önkiszolgáló: DELETE /auth/me); a
  törlés után anonimizált lenyomat (e-mail-hash) marad a visszaélés-
  védelemhez
- **TOM**: közös lista

## 2. Szállítói okmány-azonosítás (KYC)

- **Cél**: a szállítói tevékenységet végzők személyazonosságának és
  nagykorúságának megállapítása; platform-biztonság
- **Jogalap**: JÉ (I. teszt) + JK-elem (DAC7 átvilágítás)
- **Érintettek**: szállítói tevékenységre jelentkezők; kockázati alapon
  egyes feladók
- **Adatkategóriák**: személyi igazolvány két oldalának fényképe és az
  azon látható adatok; AI-előszűrés eredménye; döntés + indoklás;
  okmányszám-lenyomat (hash)
- **Címzettek/feldolgozók**: Cloudflare R2 (privát tároló, EU), Google
  LLC — Gemini API (AI-előszűrés), Railway, Neon
- **Harmadik országba továbbítás**: Google (SCC; kizárólag az elemzéshez
  szükséges képek; fizetős API-szint követelmény — lásd DPIA)
- **Törlés**: nyers fotó a döntés után 30 nappal automatikusan;
  státusz + okmányszám-lenyomat a fiók törlése után 5 évig
- **TOM**: közös lista + privát bucket, aláírt linkek, emberi döntés

## 3. Fuvar-tranzakciók (feladás, ajánlat, teljesítés)

- **Cél**: fuvarok közvetítése — feladás, ajánlattétel, elfogadás,
  teljesítés-követés, átvételi kód-alapú lezárás
- **Jogalap**: SZERZ
- **Érintettek**: feladók, szállítók
- **Adatkategóriák**: fuvar-adatok (címek, koordináták, méret/súly,
  leírás, fotók a hirdetéshez), ajánlatok és áralku, státusz-történet,
  átvételi kódok (a lezáráshoz), értékelések
- **Címzettek/feldolgozók**: Railway, Neon, Cloudflare R2 (fotók);
  Google Maps Platform (cím-geokódolás, útvonal)
- **Harmadik országba továbbítás**: Google Maps (SCC)
- **Törlés**: a fuvar-alapadatok a fiók törléséig; kapcsolódó fotók/chat:
  lásd 5–6. pont
- **TOM**: közös lista + kontakt-kapuzás (elérhetőség csak díjfizetés
  után), kód-próbálkozás-korlátozás

## 4. Kapcsolatfelvételi díj fizetése és számlázás

- **Cél**: a platform díjának beszedése, számla kiállítása, a fizetés
  visszaigazolása (kontakt-felfedés feltétele)
- **Jogalap**: SZERZ (díj) + JK (számviteli tv. — számla és bizonylat)
- **Érintettek**: díjat fizető feladók
- **Adatkategóriák**: fizetési tranzakció-azonosítók, összeg, időpont,
  fizetési mód; számlázási név/cím/adószám; kiállított számla adatai;
  45/2014. Korm. r. szerinti nyilatkozat időbélyege
- **Címzettek/feldolgozók**: fizetési szolgáltató (tervezett: CIB Bank —
  QVIK/kártya), Számlázz.hu (KBOSS.hu Kft., számla-kiállítás és
  NAV-adatszolgáltatás), Railway, Neon
- **Harmadik országba továbbítás**: nincs
- **Törlés**: számviteli bizonylatok a Számv. tv. szerinti 8 évig;
  tranzakció-naplók a fiók törlése után a jogi igényérvényesítési időig
- **TOM**: közös lista; a fuvardíj magát a platform NEM kezeli (a felek
  közt mozog)

## 5. Platformon belüli üzenetváltás (chat)

- **Cél**: a feladó és szállító kapcsolattartása a fuvar lebonyolításához
- **Jogalap**: SZERZ; zárolt megőrzés: JÉ (III. teszt)
- **Érintettek**: az ügylet felei
- **Adatkategóriák**: üzenetek tartalma, időbélyeg; fizetés előtti
  kontakt-szűrés (elérhetőség-kiszűrés a kikerülés-védelemhez)
- **Címzettek/feldolgozók**: Railway, Neon; vitás ügyben az admin
  betekinthet (vitarendezés céljából)
- **Törlés**: a fuvar lezárása után 6 hónappal automatikusan; vitás/
  zárolt ügyletnél 5 év
- **TOM**: közös lista

## 6. Fuvar-fotódokumentáció (felvételi/átadási fotók)

- **Cél**: a csomag átvételének/átadásának bizonyítása (állapot + tény)
- **Jogalap**: SZERZ; zárolt megőrzés: JÉ (III. teszt)
- **Érintettek**: az ügylet felei (közvetve: a fotón látható környezet)
- **Adatkategóriák**: felvételi és átadási fotók, időbélyeg
- **Címzettek/feldolgozók**: Cloudflare R2, Railway, Neon
- **Törlés**: a lezárás után 30 nappal automatikusan; vitás/zárolt
  ügyletnél 5 év
- **TOM**: közös lista + tartalmi fájl-ellenőrzés

## 7. Címzetti adatkezelés (átvételi értesítés)

- **Cél**: a csomag címzettjének értesítése a felvételkor (átvételi kód +
  a szállító neve/elérhetősége), kézbesítési visszaigazolás
- **Jogalap**: JÉ (a feladó és a címzett érdeke a kézbesítés
  biztonságában; a címzett nem platform-felhasználó)
- **Érintettek**: a feladó által megadott címzettek
- **Adatkategóriák**: címzett neve, telefonszáma (SMS-hez), e-mail-címe
  (ha a feladó megadta), átvételi kód
- **Címzettek/feldolgozók**: SeeMe Solutions Kft. / Dream Interactive
  Kft. (SMS-kapu, Budapest), Resend (e-mail), Railway, Neon
- **Harmadik országba továbbítás**: nincs
- **Törlés**: a fuvar-adatokkal együtt; a címzett a tájékoztatóban leírt
  módon tiltakozhat
- **TOM**: közös lista

## 8. Élő GPS-helymeghatározás — TERVEZETT (mobil-fázis)

- **Állapot**: NEM aktív. A webes fázisban élő helymeghatározás nincs;
  a backend-oldali képesség elő van készítve, a nyers helyadatokra 7
  napos automatikus törlés már be van állítva.
- **Élesítés feltétele**: kiegészítő DPIA + e nyilvántartás frissítése +
  a tájékoztató kiegészítése. Addig e pont placeholder.

## 9. Értesítések (e-mail, alkalmazáson belüli)

- **Cél**: az ügylet-eseményekhez kötött értesítések (ajánlat érkezett,
  fizetés megtörtént, kézbesítés), rendszer-üzenetek; szállítói
  útvonal-figyelő (feliratkozás alapján)
- **Jogalap**: SZERZ (ügylet-értesítések); útvonal-figyelő: SZERZ
  (a felhasználó által kért szolgáltatás-funkció)
- **Adatkategóriák**: e-mail-cím, értesítés-tartalom, olvasottság
- **Címzettek/feldolgozók**: Resend (EU), Railway, Neon
- **Törlés**: a fiókkal együtt
- **TOM**: közös lista

## 10. Csalásmegelőzés és kitiltás-kezelés

- **Cél**: visszaélések felismerése, kitiltás-megkerülés megakadályozása
- **Jogalap**: JÉ (II. teszt)
- **Adatkategóriák**: okmányszám-lenyomat, törölt fiók e-mail-lenyomata,
  aktivitás-napló (utolsó belépés, belépés-szám, aktív idő), IP-cím
  (rate-limit és biztonsági naplók)
- **Címzettek/feldolgozók**: Railway, Neon
- **Törlés**: lenyomatok a fiók-törlés után 5 évig; biztonsági naplók
  rövid, forgó megőrzéssel
- **TOM**: közös lista

## 11. Ügyfélszolgálat és panaszkezelés

- **Cél**: megkeresések, panaszok, viták kezelése (info@ / panasz@)
- **Jogalap**: SZERZ + JK (Fgytv. panaszkezelés) + JÉ (vitarendezés)
- **Adatkategóriák**: a megkeresés tartalma, levelezés, a kapcsolódó
  ügylet adatai
- **Címzettek/feldolgozók**: ImprovMX (bejövő e-mail-továbbítás),
  Google (Gmail-postafiók a megválaszoláshoz), Resend (kimenő)
- **Harmadik országba továbbítás**: Google (SCC)
- **Törlés**: a panasz-ügyek a Fgytv. szerinti 3 évig; egyéb levelezés
  az ügy lezárása után észszerű ideig
- **TOM**: közös lista

## 12. Hibafigyelés és naplózás

- **Cél**: a szolgáltatás működőképességének fenntartása, hibák észlelése
- **Jogalap**: JÉ (a szolgáltatás biztonságos működtetése — a GDPR (49)
  preambulum szerint elismert érdek)
- **Adatkategóriák**: hiba-események technikai adatai (PII-szűréssel:
  auth-fejlécek és sütik eltávolítva), szerver-naplók
- **Címzettek/feldolgozók**: Sentry (EU régió), Railway
- **Törlés**: a szolgáltatók forgó megőrzése szerint (jellemzően 30-90
  nap)
- **TOM**: közös lista + Sentry beforeSend-szűrés

## 13. Adóhatósági adatszolgáltatás (DAC7) — TERVEZETT

- **Állapot**: az operatív bevezetés folyamatban (NAV platformüzemeltetői
  bejelentkezés + szállítói adóazonosító-gyűjtés — launch-teendő).
- **Cél**: az Aktv. (DAC7) szerinti platformüzemeltetői átvilágítás és
  éves adatszolgáltatás a NAV felé a szállítókról (értékesítőkről)
- **Jogalap**: JK
- **Adatkategóriák (bevezetéskor)**: szállító neve, lakcíme, születési
  ideje, adóazonosító jele, a jóváírt ellenérték és a tranzakció-szám
- **Címzett**: Nemzeti Adó- és Vámhivatal
- **Törlés**: az Aktv. szerinti megőrzési idő
- Bevezetéskor e pont véglegesítendő + a tájékoztató kiegészítendő.

---

## Közös technikai és szervezési intézkedések (TOM)

- Titkosított átvitel mindenhol (HTTPS/TLS); jelszavak erős, sózott
  hash-sel
- Hozzáférés-kezelés: szerep-alapú (admin-végpontok külön jogosultsággal);
  munkamenet-érvénytelenítés (token-verziózás, kényszerített kijelentkezés)
- Privát object storage az érzékeny fájloknak (okmányok), rövid
  élettartamú aláírt hivatkozások; a publikus és privát tárolás szétválasztva
- Feltöltött fájlok tartalmi (magic-byte) ellenőrzése
- Automatizált adat-életciklus: napi törlő-jobok (KYC 30 nap / fotó 30
  nap / chat 6 hó / GPS 7 nap / zárolt 5 év) — kézi lépés nélkül
- Kiszivárgás-védelem fejlesztési szinten: CI-tesztek őrzik, hogy
  kívülálló pontosan a szándékolt publikus mezőket kaphatja (allowlist)
- Rate-limit a visszaélés-érzékeny végpontokon; brute-force védelem az
  átvételi kódokon
- Hibafigyelés PII-szűréssel; adatbázis napi mentés (7 napos megőrzés)
- Adatfeldolgozói szerződések (DPA) a szolgáltatókkal; EU-n kívüli
  továbbításnál SCC
- Hozzáférés az éles adatokhoz: kizárólag az ügyvezető/fejlesztő
  (jelenleg egyszemélyes szervezet); új munkatárs belépésekor
  titoktartás + jogosultság-minimalizálás kötelező

```
Kelt: Hódmezővásárhely, 2026. ___________

________________________________
Jovány Gyula, ügyvezető
Tiszta Hód Kft.
```
