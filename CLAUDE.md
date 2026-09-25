# CLAUDE.md — GoFuvar projekt context

> **2026-09-24 — Hozasd el, 2. kör (külön fejlesztési ág):** a feladásban
> termékösszefoglaló és a hiányzó cím-, méret-/súly- és díjadatokra mutató
> útmutató jelenik meg. A bútoros belépéshez eladói egyeztetési lista jár;
> méretet és súlyt nem találunk ki. A belépés jelzi a megőrzött tárgyat,
> email-megerősítés után a saját Hozasd el piszkozat közvetlenül folytatható,
> ugyanabban a böngészőben új fülből is. A meglévő validáció és díjszabás
> változatlan. Ez a bejegyzés nem állítja a 2. kör merge-ét vagy telepítését.

> **2026-09-24 — Hozasd el belépőfolyamat:** az előnézet és a kézi
> tárgymegadás belépés előtt is elérhető; a tényleges fuvarfeladás továbbra
> is fiókot és a meglévő ellenőrzéseket igényli. Új céloldal:
> `/hozasd-el/butor`. A termék- és címadatok ugyanazon böngészőfülben
> átmennek a regisztráción; a munkamenetmentés 24 órás, bejelentkezve
> fiókhoz kötött, kijelentkezéskor törlődik. Korábbi fuvarpiszkozatnál
> választás kell a cseréhez; a termékkép a fuvarpiszkozat része is lett.
> Facebook Marketplace esetén csak kézi adatmegadás van, automatikus
> beolvasást nem ígérünk. Az alábbi régi, belépéshez kötött előnézetről
> szóló bejegyzések történetiek. Az első kör a **#247** PR-rel mergelve,
> main: `6f7584b`; a Vercel és Railway telepítési állapota sikeres.

> **2026-09-15 — a `6272f5e` utóauditjának maradék két P1 javítása:**
> `fix/launch-two-p1`: a KYC véglegesítése user-sorzár alatt ellenőrzi,
> hogy a profil neve azonos-e az okmánnyal összevetett névvel; közbeni
> névcserénél 409 `KYC_PROFILE_CHANGED`, új feltöltés szükséges.
> A fizetés nélkül lemondott fuvar/foglalás bizonyított szimulált sessionje
> a lemondás tranzakciójában zárul; a valódi/ismeretlen, sikeres jelzéssel
> vagy bizonylattal rendelkező fizetés védelme marad. Új migráció: **090**,
> történeti, szigorúan feltételes javítással. Két külön javító commit:
> `e6de72c`, `0a1a02a`. Új célzott tesztek: **25/25 sikeres**; nyolc
> hibareprodukció a javítás előtti működésen elbukott. A teljes backend
> regresszió **1987/1987**, a lefedettségi kapu sikeres. Teljes ellenőrzési
> és telepítési állapot: `LAUNCH_JAVITASI_ALLAPOT.txt`, a kapcsolódó PR-ben.

> **2026-09-15 — a `704369d` utóauditjának 1 P0 + 4 P1 javítása:**
> A `fix/launch-audit-boundaries` ágon elkészült az öt külön javítás.
> A fotóretenció és a megőrzési zárolás ugyanazon ügyletsorzáron fut;
> ajánlatot csak a képernyőn látott verzióval és árral lehet elfogadni;
> vita közben is látható a feladó saját átvételi kódja a fizikai teljesítésig;
> KYC-feltöltés előtt tartós fájltakarítási feladat készül, az okmány és
> a felhasználói státusz együtt mentődik; a kupon a bizonyított CIB/QVIK
> teszt-sessiont is lezárja. **Telepítési sorrend: 088, 089 → backend/web.**
> Helyben **1962 backend + 192 web teszt**, lefedettségi kapu, webes
> típusellenőrzés, production build és 9 célzott böngészőteszt sikeres.
> A natív ajánlathívás is igazítva; a phase 2 app teljes típusellenőrzését
> egy változatlan `mobile/app/hub.tsx:56` Expo-típushiba akadályozza.
> Tételes működés, tesztek és aktuális telepítési állapot:
> `LAUNCH_JAVITASI_ALLAPOT.txt`; PR: https://github.com/propertyTitan/BiztosFuvar/pull/240.
> A KYC fájlírás alatt a takarítási feladat zárolt; a feltöltés legfeljebb
> 60 másodpercig várhat az R2-re. A korábbi javítások története alább;
> az új kör nem állítja, hogy minden további P0/P1 lehetőség kizárt.

> **2026-09-15 — launch előtti P0/P1-javítások:** a P2 PR #237 és a két
> P0-t javító PR #238 összevonva; a Railway production a `0befe774` main
> commitot futtatja. A **12 P1 kódjavítása elkészült** a
> **PR #239-ben**; tételes követés és korlátok:
> `LAUNCH_JAVITASI_ALLAPOT.txt`. Közös tranzakciós fióktörlés tartós
> fájltakarítással; megőrzött fizetési munkamenetek; atomi referral és vita;
> telefon/KYC/foglalási jogosultság; webes retry, vita alatti kézbesítés és
> socket-visszacsatlakozás. **085–087 a production DB-n lefutott:** 87
> alkalmazott migráció, 0 függő, 35 fizetési kapcsolat megőrizve.
> Helyi ellenőrzés: **1933 backend + 180 web teszt sikeres**, production
> build sikeres, backend lefedettségi kapu sikeres. Ugyanezen új próbákból
> 31 elbukik a régi kódon, mind a 12 P1-et érintve. A végleges CI/merge
> állapota: https://github.com/propertyTitan/BiztosFuvar/pull/239 — a futó
> Railway commitot ehhez kell ellenőrizni, nem a történeti P0-hashhez.
> A CIB éles adaptere továbbra is külön feladat.

> **2026-09-15 — a friss audit 1–6. pontjának javítása, `codex/audit-hat-javitas` ágon:**
> Hat külön javítás: atomi díjkönyvelés és tartós számlapótlás; szállítói
> jogosultság újraellenőrzése megállapodáskor; atomi kuponbeváltás;
> azonnali elfogadás a látott pozitív ár megerősítésével; induláskor csak
> HUF-ajánlat; visszafuvar-szűrés/távolság/pontszám közelítő helyadatból.
> **Telepítési sorrend:** először `084_fee_payment_receipts.sql`, majd backend
> és web. Az instant API-n az `expected_price_huf` kötelező; a web elküldi,
> a szándékosan elrejtett instant gomb rejtve marad. Régi EUR-ajánlat
> helyett új HUF-ajánlat kell. A számlapótló kör a még el nem indított
> számlázást újrapróbálja; meglévő pending/failed számlánál Sentry-riasztás
> és számlázói egyeztetés kell, automatikus újrakiállítás nincs.
> A díjbizonylat a fizető saját adatexportjában szerepel, és a számlákhoz
> igazodó 8 éves törlési kör kezeli. Lokális ellenőrzés: **1887 backend +
> 149 web teszt sikeres**, TypeScript és Next production build sikeres;
> backend lefedettségi kapu sikeres (sorok 93,35%, utasítások 91,93%,
> függvények 89,07%, elágazások 84,38%).
> **Merge előtti ellenpróba:** a hat hibát fedő 19 próba a régi
> `c37354f` kódon elbukik; a javított kódon mind a 34 audit-regresszió
> sikeres. A kupon-versenyhelyzet tesztje valódi DB-zárral szinkronizál,
> így a két kérés nem kerülheti el véletlenül az ütközést.
> **Éles migráció: 2026-09-15-én lefutott a 084-es**, visszaellenőrizve:
> 84 nyilvántartott migráció, nincs függő fájl, a díjbizonylat-tábla létezik.
> PR: #236; a migráció önmagában nem jelenti a kód telepítését.

> **Ez a fájl automatikusan betöltődik minden új Claude-session elején.**
> Tartsd naprakészen ahogy a projekt változik.
>
> Tartalom: ki a user, mi a GoFuvar, hogyan dolgozunk, mi van készen,
> mi van hátra, és minden olyan döntés, amit nem akarsz minden új
> session-ben újra elmagyarázni.
>
> **Technikai térkép:** a "mi hol van a kódban, mi mire épül" kérdésre a
> **`CODEMAP.md`** válaszol (route-ok, service-ek, web↔backend híd, hol kezdj
> keresni). Új feature előtt érdemes átfutni.
>
> **Történeti melléklet:** a lezárt körök TELJES naplója (Manus-jelentések
> 2026-08-30/31, audit-listák, a ✅ Kész (élesedett) tételes lista
> 2026-09-11-ig) a **`CLAUDE2.md`**-ben van. Az NEM töltődik be
> automatikusan (2026-09-17-én a CLAUDE.md 258 KB volt, a Claude Code 150 KB
> fölött figyelmeztet) — csak akkor nyisd meg, ha egy régi javítás RÉSZLETE
> kell (melyik PR, melyik őr-teszt, miért). Az élő szabályok itt vannak.

---

## 1. Ki a user

- **Jovány Gyula**, Tiszta Hód Kft. képviseletében — apukád az ügyvezető
  és cégtulajdonos, te csinálod a fejlesztést + biz dev-et
- Magyar nyelvű kommunikáció mindig
- Solo founder a launch előtt — **nem építünk csapatot bevétel előtt**
- Vállalja a felelősséget AI-generált tartalmakért (jogi szöveg, ÁSZF, GDPR)
- Realisztikus cél: **havi 2-3M Ft bevétel** ~18 hónap után, ez a base-case
- Üzleti modell: 10% jutalék + 400 Ft fix admin díj per fuvar (Bolt-modell)
- Stratégia: **web-first launch**, natív app phase 2 (Apple-jóváhagyás után)

---

## 2. Mit csinál a GoFuvar

P2P fuvarozási marketplace Magyarországra, intercity-fókuszú (Pest ↔ Szeged /
Debrecen / Pécs / stb.), de **európai (EU+EGT) coverage**-szel.

Két fél:
- **Feladó** — csomagot küld, ár-licitet vagy fix áras útvonalat fogad el
- **Sofőr** — fuvart vállal, fotó + 6 jegyű kód lezárás

A platform NEM fuvarozó, csak közvetítő (Ptk. értelmében sem). A fuvarozási
szerződés kizárólag a Feladó és a Sofőr között jön létre.

### Fő feature-ek (mind élesedett)
- Licites fuvar + fix áras útvonal-foglalás (⚠️ **a JÁRAT-ág a launchra REJTVE, 2026-09-11 D1** — kapcsoló: `NEXT_PUBLIC_JARAT_ENABLED` + `JARAT_ENABLED`) + visszafuvar matching + instant ("UberFuvar")
- KYC AI-val (Gemini olvas ID-t, kor-ellenőrzés, admin jóváhagyás)
- **Közvetlen fizetési modell (2026-07-03; 2026-09-10-től készpénz VAGY
  átutalás)**: a fuvardíj KÖZVETLENÜL a szállítóé (100%, levonás nélkül) —
  a felek döntik el, készpénzben vagy átutalással rendezik; a platform
  sávos KAPCSOLATFELVÉTELI DÍJAT szed a
  feladótól elfogadáskor (QVIK, sima díjfizetés — NEM kell escrow!);
  kontakt-felfedés csak a díj után; az escrow-kód dormant (később
  "Védett fizetés" opció lehet)
- 6 jegyű átvételi kód + QR kód
- **1 db SMS-modell (2026-07-13, user-döntés)**: a címzett EGYETLEN SMS-t kap,
  a csomag FELVÉTELEKOR (átvételi kód + sofőr neve/telefonszáma + "egyeztess
  vele az érkezésről"); **ÉKEZETESEN megy (user-döntés, minőség)** → UCS-2.
  ⚠️ **2026-09-10 (user-döntés): + „csak az átadáskor add meg a szállítónak"
  mondat → max 3 szegmens (~57 Ft/fuvar, worst case 188 kar; név 14
  karakterre vágva)** — a címzett eddig nem tudta, hogy a kódot nem szabad
  előre bediktálnia; a +19 Ft vállalt ár. Az őr (`sms-szegmens-or`) a 3-as
  plafont ÉS a mondat meglétét tartja. (Korábban: max 2 szegmens, ~38 Ft;
  a sendSms már NEM ékezettelenít, a removeAccents export megmaradt
  spórolás-tartaléknak); minden más értesítés email/in-app — kézbesítésről
  email a feladónak + a címzettnek is, ha van email-címe. A korábbi 5 SMS-ből
  a feladáskori KI (túl korai volt: sofőr sem volt még), az 5km/300m KI (GPS
  úgyis mobil-fázis; email maradt), kézbesítési 2 db SMS→email. Ok: SMS
  ~20-30 Ft/db vs email ~0 → base-case volumenen ~100+ ezer Ft/hó megtakarítás.
  ÁSZF 6.5 + chatbot-tudás + landing-szövegek igazítva
- Élő GPS-tracking (background, dinamikus 60s→15s frekvencia) — ⚠️ a
  backend kész, de élő pozíció CSAK a mobilapppal lesz (Phase 6); a
  web-first launchon MINDENHOL "Hamarosan"-ként kommunikáljuk (2026-07-03
  döntés, PR #48: landing badge, chatbot-tudás, tracking-oldal szövege)
- Privát file storage (R2 + audit log)
- Email verifikáció + password reset — **KEMÉNY kapu (PR #68)**: regisztráció
  után blokkoló "Erősítsd meg az email címed" képernyő, csak verifikálás után
  enged tovább (EmailVerifyGate; frontend-oldali kapu)
- Sofőri KRESZ-nyilatkozat kapu (PR #67) — jogosítvány NEM kell, személyi elég
- Sentry hibajelzés (✅ éles: web + backend)
- Dispute system, Review system, Chat
- Admin CRUD panel
- Coverage zones (Európa-szintű, magyar fő piac)
- PWA telepíthető a kezdőképernyőre

---

## 3. Tech stack

```
Web (Vercel)          Mobil (Expo React Native, NEM élesedett)
   ↓                                ↓
   └─────→ Backend (Railway Hobby, $5/hó) ←────┘
                       ↓
   ┌───────────────────┼────────────────────┐
   ↓                   ↓                    ↓
 Neon (Postgres)    Cloudflare R2        Külső:
 (eu-central-1)     (privát bucket)       Fizetés: QVIK (user-döntés
                                            2026-07-11: Barion VÉGLEG elvetve
                                            — "meguntam a velük lévő harcot";
                                            a Barion-kód dormant fallback,
                                            NEM élesítjük, Pixel se kell)
                                          SeeMe.hu (SMS, STUB)
                                          Resend (email, ✅ ÉLES)
                                          Sentry (hibafigyelés, ✅ ÉLES)
                                          Google Gemini AI
                                          Google Maps Platform
```

### Repo
- `propertytitan/biztosfuvar` GitHub
- Production branch: **`main`**
- Vercel auto-deploy main-re (Production Branch beállítva)
- Railway auto-deploy main-re (Auto-deploys when pushed = enabled)
- Munkavégzés: feature-branch → PR → merge to main → auto-deploy

### Adatbázis
- **Az ÉLES adatbázis Neon** (Postgres, eu-central-1), nem Supabase!
  Host: `ep-lively-violet-al932ok8-pooler.c-3.eu-central-1.aws.neon.tech/neondb`
- A backend a `DATABASE_URL` env-ből csatlakozik (`backend/src/db.js`), Railway-en
  beállítva; a prod connstring lokálisan is megvan `backend/.env`-ben
- Migrációk lokálisan futnak a prod ellen: `npm run db:migrate` — **2026-09-11
  óta NYILVÁNTARTÁSSAL** (`schema_migrations` tábla, advisory lock): egy fájl
  EGYSZER fut. ⚠️ SZABÁLY: már lefuttatott migrációs fájlt NEM szerkesztünk —
  új változás = új fájl. (Előtte a futtató minden fájlt minden futásnál újra
  végrehajtott; a 034-es feltétel nélküli UPDATE-je így minden nem igazolt
  fiókot igazolttá tett — Codex-audit P0-01. Őr:
  `migracio-ujrafuttatas-or.test.js`: kétszer futtat + WHERE nélküli
  UPDATE/DELETE tilos a migrációkban.)
- RLS nincs használatban (a backend egyetlen DB-userrel csatlakozik) — DB-credet
  SOHA ne tegyünk a frontendre
- ⚠️ A régi Supabase projekt (`frlxrbdfcuojzhafelyn`) **NEM használt, de NEM
  üres sémájú**: a teljes GoFuvar-séma ott van (24 tábla, korai fejlesztésből),
  viszont **minden tábla 0 soros** és `auth.users` is 0. 2026-07-09: a Supabase
  "RLS disabled / sensitive data publicly accessible" riasztására az **RLS mind
  a 24 táblán bekapcsolva** (policy nélkül = semmi nem fér hozzá — nem használt
  projektnél ez a kívánt állapot; adat NEM szivárgott, mert nincs benne adat).
  2026-07-09: a projekt **SZÜNETELTETVE** (paused — API+DB elérhetetlen);
  a végleges törlés csak a Supabase dashboardon lehetséges (Settings →
  General → Delete project), user-teendő. Ugyanekkor a backend 5 perces
  DB keep-alive pingje KIVÉVE (PR #70) — Supabase-maradvány volt, a Neont
  tartotta ébren 0-24 (valószínű júniusi kvóta-kifutás ok); a Neon most
  üresjáratban alszik, első kérésnél ~1 mp cold start. Ha DB-eredetű
  "Szerverhiba" (500) jön, a **Neont** kell nézni — NEM a Supabase-t
  (kvóta: console.neon.tech)

### R2 bucket
- `gofuvar-uploads` a Cloudflare account `4ffc8483390d0d1da83fab3ba05a4172`-en
  — publikus (job-fotók, avatarok); ez maradhat így
- **`gofuvar-kyc` PRIVÁT bucket (2026-07-13)**: a KYC-okmányfotók ide mennek
  (`private:<kulcs>` a DB-ben, publikus URL NINCS) — olvasás CSAK rövid
  életű presigned URL-lel (admin-lista + feltöltés-válasz szerver-oldalon
  írja alá; env: `R2_PRIVATE_BUCKET_NAME`). Régi fotók átköltöztetése:
  `backend/scripts/kyc-privat-migracio.js`. A teljes privát-refactor
  (job-fotók + audit log) továbbra is Phase 6

---

## 4. Cégadatok (ÁSZF, számlázás, Apple Developer)

```
Cégnév:           Tiszta Hód Korlátolt Felelősségű Társaság (Tiszta Hód Kft.)
Székhely:         6800 Hódmezővásárhely, Szántó Kovács János utca 144.
Cégjegyzékszám:   06-09-020646
Adószám:          24750792-2-06
Ügyvezető:        Jovány Gyula (apa)
Központi email:   info@gofuvar.hu
Panasz email:     panasz@gofuvar.hu
Telefon:          +36 20 397 9223
Békéltető test.:  Csongrád-Csanád Megyei
Bíróság:          Hódmezővásárhelyi Járásbíróság / Szegedi Törvényszék
```

**Apple Developer Program**: apukád enroll-ol (ő a jogi képviselő), a fia
(user) Admin-ként van hozzáadva — ezt megbeszéltük.

---

## 5. Üzleti döntések (NE változtasd ezeket egyoldalúan)

| | Mit |
|---|---|
| Üzleti modell | **KÖZVETLEN FIZETÉS a felek közt (2026-07-03 pivot, felelősséget vállalta)**: a fuvardíj 100%-a a sofőré, a platform NEM kezeli; bevétel = kapcsolatfelvételi díj. A korábbi 10%+400 escrow-modell hatályon kívül (kód dormant, később "Védett fizetés" opció). ⚠️ **2026-07-15 pontosítás**: a fizetés NEM korlátozott készpénzre — a felek megállapodhatnak **átutalásban is** (pl. cég-cég közt); az ÁSZF 4.2 + chatbot ezt megengedi. ~~A "készpénz" csak a C2C-marketing egyszerű ALAPÜZENETE (landing marad kápé-fókuszú)~~ → **2026-09-10 user-döntés: a felület SEHOL nem szűkíti készpénzre** — a fuvardíjat a felek úgy rendezik, ahogy megegyeznek (készpénz VAGY átutalás). SZÖVEG-SZABÁLY: „közvetlenül a szállítónak — készpénzben vagy átutalással, ahogy megegyeztek"; TILOS a „készpénzes fizetés/fuvardíj" cím, a „kápé" szleng, és a „készpénzben adod/kapod/jár" a közeli „átutalás" nélkül (a szövegőr, 13-as spec őrzi a marketing-oldalakon + manifeszten). A landing, a feladói/szállítói felület, az e-mailek, az in-app értesítések, a chatbot-tudás és az ÁSZF 4.2 mind átírva (2026-09-10). A lényeg változatlan: a díj sosem folyik át a platformon |
| Kapcsolatfelvételi díj | **EGYSZERŰSÍTETT LAUNCH-ÁRAZÁS (2026-07-15, user + ügyvezető döntése — elsődleges cél a USER-GYŰJTÉS)**: ≤50 000 Ft fuvardíjig → **500 Ft** / felette → **1.000 Ft**, bruttó, BEVEZETŐ ár (mindenhol így kommunikálva!). A korábbi 4 sávos (500/1490/2490/3990) struktúra hatályon kívül. NEM visszatérítendő (45/2014. 29.§(1)a consent-checkbox a fizetésnél); a fuvarra szól: sofőr-meghiúsulásnál díjmentes újraválasztás, másik fuvarra NEM vihető át. **2026-ban a bevezető sávos ár marad; díjemelés legkorábban 2027-től** (user döntése, 2026-07-06; korábbi emelési jelzés: stabil ~300+ fuvar/hó). **2026-07-11 fontolgatás (NEM döntés): feladói B2B-előfizetés** — 3.990 Ft/hó, mellette minden feladás fix 400 Ft kapcsolatfelvételi díj (sávtól függetlenül); break-even a feladónak: ~2-4 közepes/nagy fuvar/hó → önszelektáló, a visszatérő céges feladót fogja meg. ⚠️ A 2026-07-15-i egyszerűsített árazással (500/1000) ez a matek ELAVULT — ha a B2B-csomag napirendre kerül, újraszámolandó. Feltételek ha egyszer élesedik: fair-use plafon (viszonteladó-arbitrázs ellen), céges/KYB-fiókhoz kötés javasolt, recurring fizetés kell; legkorábban 2027, a team/multi-user + sofőr-előfizetéssel egy polcon ("GoFuvar Business") |
| Sofőr díjmentessége | **2026-ban a sofőr BIZTOSAN díjmentes** (user döntése, 2026-07-06): a fuvardíj 100% kápé, a platform a sofőrtől semmit nem szed. A megfontolt **sofőr-előfizetés** (990 Ft/hó, ELSŐ HÓNAP INGYEN, token-alapú auto-megújítás) NEM 2026-os — legkorábban **2027**, és CSAK ha (a) a Barion recurring/token fizetés él, (b) van sűrű fuvarforgalom (a sofőr egy nap alatt visszakeresi). **2026-07-11 user-pontosítás:** ársáv **1.000–2.000 Ft/hó**, trigger: **~500–1000 AKTÍV sofőr** (javasolt mérce: aktív = havi ≥1 teljesített fuvar — a fuvarsűrűség a valódi feltétel, nem a regisztrált darabszám); még csak fontolgatás, nem döntés. Jogi: auto-megújítás fogyasztóvédelmi tájékoztatás + könnyű lemondás + terhelés előtti emlékeztető. Kártyát nem a regisztrációnál, hanem az ingyen hónap vége felé / első fuvarnál javasolt kérni (kínálat-megtartás) |
| Kontakt-kapuzás | Telefonszám/email CSAK a díj megfizetése után látszik (ez a kikerülés-védelem lényege; chat contactGuard fizetés előtt szűr) |
| Cím + vészkód a díj előtt | **2026-08-30 user-döntés (Manus GF-008/010)**: a díj megfizetése ELŐTT a szállító (böngésző ÉS kijelölt) csak UTCA-SZINTŰ címet lát (házszám nélkül, koordináta ~110 m-re kerekítve — `utcaSzint`, utils/address.js); a feladó SAJÁT vészhelyzeti kódja (sender_delivery_code) is csak `paid_at` után jár (backend-scrub + UI). A pontos cím/kód a díj után. Ezzel a régóta nyitott „nyitott fuvar cím-pontossága" termékdöntés LEZÁRVA |
| Lemondási díj | **NINCS** — lemondás ingyenes, de a befizetett díj nem jár vissza |
| Kárfelelősség | NINCS platform-szabta kárplafon — a platform nem felel, a Feladó és a Sofőr a Ptk. szerint rendezi egymás közt (ÁSZF 5.2) |
| Coverage | **Európa-szintű** (lat 34-71, lng -10..32) — magyar fő piac, EU mellesleg |
| Csomag tilalom | NINCS hardcoded lista — a Feladó felelős hogy ellenőrizze a sofőr engedélyét speciális áruhoz (élő állat, gyógyszer, stb.) |
| Sofőri KYC / biztosítás | **⚠️ FELADÓNAK NEM KELL SZEMÉLYI (2026-07-19, user-döntés, PR #96)** — az identity KYC CSAK a szállítói tevékenységhez kötelező (ajánlattétel/járat-hirdetés előtt); a feladó email-megerősítéssel feladhat és fizethet (a banki díj-fizetés a de facto azonosítás; iparági minta: Shiply/uShip; cél: feladói konverzió + admin-tehermentesítés + GDPR-minimalizálás). A `requireIdentityKYC` middleware megmaradt KOCKÁZAT-ALAPÚ eszköznek (nagy érték/vita/gyanú esetén visszatehető — az ÁSZF 3.2 kifejezetten fenntartja a jogot). Referral: feladói úton a jutalom-feltétel a TÉNYLEGES díj-fizetés (KYC nem kell), szállítói úton marad a KYC. **Jogosítvány NEM kell (2026-07-07)** — a személyi igazolvány (identity KYC) elég a szállítói mindenhez; így a nem-motoros futárok (bringa, gyalog, tömegközlekedés) is mehetnek. Sofőri egyszeri **nyilatkozat** (jogszabályok + KRESZ betartása) a sofőr-mód első használatakor (`driver_terms_accepted_at`, `POST /auth/accept-driver-terms`, DriverTermsGate). Külön **KGFB-nyilatkozat NINCS** (a KGFB magyar jog szerint úgyis kötelező minden gépjárműre; az ÁSZF 3.4 általános „minden jogszabályt betart" kikötése fedi). Casco/CMR NEM kötelező. ⚠️ marketingben TILOS a „jogosítvány nem kell" (ne hívjuk fel rá a figyelmet) — csak pozitív „bármivel mehet". ÁSZF 3.2/3.4 + adatkezelés átírva. Jogosítvány-plumbing dormant. Kor: ÁSZF 3.1 = 18+ (16+ = ügyvéd-kérdés) |
| Céges fiók (KYB) | **Adószám + cégnév KÖTELEZŐ (formátum-ellenőrzéssel), de NINCS dokumentum/fotó/admin-jóváhagyás (2026-07-05, PR #57)** — a régi company_verification kapu kivéve, a plumbing dormant. A természetes személyt az identity KYC védi. A NAV adószám-ellenőrzés + "Ellenőrzött cég" jelvény (Option B) **MEGÉPÍTVE (2026-07-19, PR #94) — csak a NAV technikai user env-jei hiányoznak** (aktiválás a ✅ listában); következő lépcső a reputációs "Kiemelt fuvarozó" (uShip/Shiply-modell). Céges perszónák: költöztető cég, bútorbolt, fuvarozó |
| KYC retention | ✅ AKTÍV (2026-07-16-án ellenőrizve, a CLAUDE.md sokáig tévesen "nem aktív"-ként tartotta nyilván): a nyers okmányfotó a döntés (approved/rejected) után 30 nappal AUTOMATIKUSAN törlődik (napi job: `purgeOldKycFiles`, index.js ütemezi; pending-et nem bántja; a privát bucket kulcsait is kezeli). A metaadat (státusz + doc_number_hash csalásvédelemhez) marad — erre vonatkozik az 5 év a fiók-törlés után (ÁSZF). **Fuvar-fotók (pickup/dropoff, 2026-07-16 user-döntés, PR #91): alapból 30 nap a lezárás után, AUTOMATIKUS napi törléssel** (`retention.js` — 2026-07-17-én átnevezve, a chat+GPS purge is itt él); vitarendezés (a vita-nyitás auto-zárol: `photo_retention_hold=TRUE`, a vita lezárása után is marad) vagy admin-zárolás (`PATCH /admin/photo-hold`) esetén az érintett fuvar/foglalás fotói 5 évig, utána azok is törlődnek. 'listing' fotót nem érint. Adatkezelési 5. szakasz átírva. 049-es migráció |
| GPS retention | ✅ GÉPESÍTVE (2026-07-17, PR #92): 7 nap után a nyers pingek auto-törlődnek (a job már él, pedig az élő GPS csak a mobil-fázisban indul — sosem gyűlhet) |
| Chat retention | ✅ GÉPESÍTVE (2026-07-17, PR #92): 6 hónap a fuvar lezárása után auto-törlés; zárolt (vitás/admin-holdos) ügyletnél 5 év — ugyanaz a `photo_retention_hold` flag védi, mint a fotókat (egységes bizonyíték-zárolás) |
| App store | **NINCS** még — PWA telepítéssel megy |
| Marketing-stratégia | Top 5 magyar útvonal (Pest-X) + intercity fókusz |
| Customer-base | Egyetemista bútor-átvitel, marketplace eladók, IKEA-vásárlók (3 perszóna) |

---

## 6. Mit készítünk a launchhoz

### 🧭 TELJES AUDIT (2026-09-11/13) — 4 lencse, P0/P1/P2 terv; ✅ 9 CSOMAG + ÚJRA-AUDIT D1–D4 ÉLESBEN

> A Codex-csomagok után a user teljes körű átvizsgálást kért („mielőtt
> bármit módosítasz, értsd meg"), majd a leletre: **„csináld, legyen
> hibátlan közeli… megbízható, modern, jól használható, ne tudják könnyen
> megkerülni."** Négy lencse (backend pénz-út + állapotgép, adatvédelem/
> kikerülés, web UX + 3 felhasználói út, üzemeltetés), minden tétel kódból
> igazolva. A javítás csomagokban ment, minden fixhez őr-teszt, ami a
> javítás NÉLKÜL igazoltan piros; PR → CI → merge → prod-ellenőrzés.
> **ÁLLÁS (2026-09-12 reggel): a 9 csomag (A1–A4, B1–B3, C1–C2) a
> #221–#229 PR-ekkel MIND BEOLVADT és a Railway/Vercel futtatja; a 081,
> 082, 083 migráció a prodon LEFUTOTT és visszaolvasva (XOR + egyedi
> index + SET NULL; `no_offer_nudge_at`; webhook-indexek + messages XOR).
> Végállás: backend 155 fájl / 1789 teszt, web 27 fájl / 141 teszt, E2E
> zöld minden PR-en. ⚠️ AMI NEM BIZONYÍTOTT: az új felületek (telefon a
> nyilatkozatban, MapCollapse, visszavonás-gomb, szerkesztés-dialógus,
> GPS-sáv) csak unit/tsc/build/E2E-szinten mértek — élő kattintás a
> useré; a webhook-claim csak stub-providerrel tesztelt (a valódi CIB
> ismétlési viselkedése az élesítéskor derül ki).**
>
> **Csomagok és állás:**
> - **A1 ✅ (backend P0-mag, `audit-a1-p0-mag.test.js`, 5 őr):**
>   (1) a fizetési webhook a `paid_at`-ot CSAK `accepted`/`disputed`
>   (fuvar) ill. `confirmed`/`disputed` (foglalás) állapotra írja — eddig
>   egy lemondott fuvarra érkező késleltetett Succeeded fizetetté tette,
>   számlát állított ki és indulásra szólította a szállítót; most „ÁRVA"
>   payment_events sor (`processed=false`) + Sentry, kézi sztornó a teendő;
>   (2) kuponos (0 Ft) fuvar újraválasztása: `connection_fee_huf != null`
>   (a 0 hamis volt → 500/1000 íródott be → az ajánlói őr „valódi
>   fizetésnek" látta, a kupon kupont termelt); (3) utca-szint a
>   `/auth/me/driver-dashboard` és az export `vallalt_fuvarok` sorain
>   `paid_at` nélkül (a scrub megkerülésével ment a házszám — azonnali
>   elfogadás → dashboard → visszalépés = lakcím ingyen); (4) a
>   foglalás-felvétel feltételes UPDATE (`AND status='confirmed'`, 409
>   STATE_CHANGED) — a fuvar-ág párja ma reggel kapta, ez kimaradt.
> - **A2 ✅ (backend pénz-út, `audit-a2-penz-ut.test.js`, 16 őr — 14
>   igazoltan piros a javítás nélkül, a plafon-teszt külön a régi
>   referral.js ellen):** (1) **ÚJ `services/feePayment.js` — KÖZÖS
>   könyvelési mag**: állapot-őr + egyszeri `paid_at` + díj-sor + ÁFA +
>   számla + fizetési napló + ajánlói trigger; a webhook ÉS a kézi
>   (teszt-üzemi) nyugtázás mindkét ágon ezt hívja — a kézi út eddig csupasz
>   UPDATE volt (se őr, se napló, se számla: a tesztelő nem azt járta végig,
>   ami élesben fut). (2) **Webhook idempotencia-CLAIM az elején**
>   (`claimPaymentEvent`: INSERT … ON CONFLICT DO NOTHING; kivételnél
>   felszabadul, 2 percnél régebbi elakadt claim átvehető; a napló hibájánál
>   FAIL-OPEN — a fizetés a pénz, a napló kényelem). Az A1-es árva-ág
>   `event_type='orphan'` + `processed=true` lett (végleges, nem újrapróbált;
>   a `logPaymentEvent` ON CONFLICT-ja most minden oszlopot frissít). (3) **Az
>   ajánlói jutalom a FIZETÉSI NAPLÓRA épül** (webhook/manual, processed, >0
>   Ft), nem a `paid_at`-ra — a kupon, a kézi SQL és az árva fizetés nem
>   termel kupont; **plafon a claim ELŐTT** → betelt hónapnál a meghívott
>   jelöletlen marad, a jutalom HALASZTOTT, nem elvesző (a 2026-08-08 óta
>   nyitott policy-kérdés így zárult: deferred, nem hard cap). ⚠️ A
>   teszt-helper `createJob/createBooking({ paid: true })` mostantól
>   napló-sort is ír (`logPaidFee`) — a fixtúra azt hagyja hátra, amit a
>   webhook. (4) `notifyDealClosed(…, feeAlreadyPaid)`: díjmentes
>   újraválasztás után NINCS „fizesd meg a díjat" felhívás/e-mail, a
>   szállító „már rendezve"-t kap. (5) Reopen nullázza a
>   `payment_reminder_count`-ot. (6) Közelség-értesítés rowCount-kapuval
>   (párhuzamos pingekből egy értesítés). (7) Vita: `resolved_*`-hez
>   kötelező indoklás (≤2000), `refund_huf` 0–10M egész; vita-nyitáskor
>   e-mail a másik félnek + in-app minden adminnak + e-mail a
>   `DISPUTE_ALERT_EMAIL || panasz@gofuvar.hu` címre (PII-minimum: leírás
>   nélkül). (8) Admin PATCH /admin/users: KYC/cég-státusz enum, `can_bid`
>   boolean, `trust_score` 0–100, `level` 1–N; a fizetési napló admin-naplója
>   a 403 UTÁN. (9) PATCH /auth/me: típus+hossz kapu (vehicle_type 100,
>   company_name 200, company_reg_number 40, billing_address 300), EU-adószám
>   formátum + normalizálás.
> - **A3 ✅ (`audit-a3-email-riasztas.test.js`, 6 őr, mind piros a javítás
>   nélkül):** a `sendEmail` eddig egyetlen `console.error`-ral nyelte el a
>   kiesést (21 hívóhely `.catch(() => console.warn)`-nal) — egy
>   Resend-kiesés vagy lejárt kulcs napokig észrevétlen maradt volna.
>   Most: ÁTMENETI hiba (429/5xx/hálózat) → 2 újrapróba rövid backoffal
>   (`EMAIL_RETRY_BACKOFF_MS`, alap 1 s + 4 s, ugyanabban a hívásban);
>   VÉGLEGES kiesés → Sentry-riasztás hibamódonként (http-4xx / http-5xx /
>   network) 10 percenként max egyszer, a közben elveszett levelek
>   SZÁMÁVAL (címzett maszkolva, tárgy maskInText, body soha). A
>   `createNotification` beszúrás-hibája is Sentry-be megy. ⚠️ Tudatos
>   korlát: NINCS DB-alapú újraküldési sor (az SMS-nek van, mert ott 10
>   napos kiesés volt) — ha a Sentry ismétlődő e-mail-kiesést mutat, az a
>   következő lépcső (`email_retry_queue` az smsRetry.js mintájára).
> - **A4 ✅ (`audit-a4-integritas.test.js`, 12 őr — 9 piros a forrás nélkül,
>   3 a 081-es migráció DB-kényszereit méri; 081 a prodon LEFUTOTT):**
>   (1) **Vita**: XOR (pontosan egy ügylet) + részleges UNIQUE index a
>   nyitott vitákra (job/booking) — öt párhuzamos nyitásból egy 201, a többi
>   409 (`DISPUTE_ALREADY_OPEN`), mindkét azonosító → 400. (2) **`POST
>   /bids/:id/withdraw`**: a szállító visszavonja a függő ajánlatát (a
>   feladó `bid_withdrawn` értesítést kap; a reopen a 'withdrawn'-t NEM
>   éleszti, az újra-ajánlás engedi); ⚠️ a web-gomb a B csomagban. (3)
>   **Fizetetlen megállapodás lejáratása** (`runPaymentExpiry`, a napi
>   emlékeztető-kör része): 2 emlékeztető + `PAYMENT_EXPIRE_AFTER_HOURS`
>   (alap 72 h) után a fuvar 'cancelled' (`cancel_reason
>   'payment_expired'`), a függő díj-sor 'refunded', mindkét fél in-app +
>   e-mail. DÖNTÉS: lezárás, NEM újranyitás — egy hat napja nem reagáló
>   feladó fuvarja zombi-hirdetés lenne. (4) **FK-k**: `reviews.reviewer_id`
>   / `job_id` / `booking_id` ON DELETE SET NULL (a törölt értékelő vagy a
>   törölt fuvar nem viszi el a MÁSIK fél kapott csillagát; a törölt ember
>   szabad szövege a fiók-törléskor ürül; a profil „Törölt felhasználó"-t
>   mutat; a 078-as XOR „legfeljebb egy"-re enyhült); `escrow_transactions.
>   job_id` SET NULL (a pénzügyi sor túléli a fuvar törlését — Számv. tv. 8
>   év). (5) **Sugár-keresés az SQL-ben** (haversine + távolság szerinti
>   sorrend, csak `radius_km`-mel; koordináta/sugár-kapu 400) — eddig a
>   `LIMIT 200` UTÁN, JS-ben szűrt: a 200 legfrissebbnél régebbi közeli
>   fuvar láthatatlan volt. (6) **Fotó-plafon**: 10/típus/ügylet
>   (`PHOTO_MAX_PER_KIND`, 400 `PHOTO_LIMIT`). (7) **Címzetti e-mail**:
>   feladáskor KÓD NÉLKÜL (a sablon megmondja, mikor jön), a kód +
>   szállító elérhetőség a FELVÉTELKOR megy (`sendRecipientPickupEmail`,
>   fuvar + foglalás ág, az SMS párja) — a 2026-08-11 óta nyitott
>   „elgépelt címre érvényes kód" kérdés így zárult.
> - **B1 ✅ (web-mag + backend-kapu; `audit-b1-szallito-telefon.test.js`,
>   web `features.test.ts` + `profil-cache.test.ts`, mind piros a javítás
>   nélkül):** (1) **Telefonszám kötelező a szállítónak** — a
>   `requireDriverKYC` 403 `PHONE_REQUIRED`-del zár (a díj után a feladó a
>   szállító telefonját kapja; enélkül üres kontaktot fizetne ki); a
>   DriverTermsGate a nyilatkozat mellett bekéri a telefont, ha a profilban
>   nincs; az ajánlat-oldal a kódra magyar üzenettel válaszol (a `request()`
>   mostantól a `code`-ot is ráteszi a hibára). (2) **DriverTermsGate
>   Mégse/ESC** — eddig csapda volt: most visszavált feladó módba és a
>   főoldalra visz. (3) **Járat-szivárgás ×4 lezárva** (PostedJobs „Járataim"
>   + „Új fix áras", sofor/fuvarok üres CTA, HomeHub „Foglalásaim", stub-fizetés
>   vissza-link) — a features-őr forrás-szinten tartja. (4) **Ajánlat
>   visszavonása** gomb a függő ajánlat kártyáján (ConfirmDialog →
>   `api.withdrawBid`). (5) **Profil-cache**: `api.getMyProfile` 15 s TTL +
>   token-kulcs + `invalidateMyProfile` (a PATCH és a nyilatkozat
>   automatikusan invalidál) — öt komponens öt kérése egyre olvadt.
>   (6) **Mobil mód-chip** a fejléc mobil menüjében („Szállító mód — váltás a
>   főoldalon").
> - **B2 ✅ (web UX; `MapCollapse.test.tsx`, `urlapPiszkozat.test.ts`,
>   `navigacio.test.ts`, `vita-ui.test.ts`):** (1) **Kettős vita-UI
>   összevonva** a feladói fuvar-oldalon (a DisputeButton + második
>   „folyamatban" doboz ki; a „Probléma van a fuvarral?" kártya + dialógus
>   marad, 'completed'-en is; a szállítói oldalon a DisputeButton az
>   egyetlen út — a 03-vita E2E-spec igazítva). (2) **`MapCollapse`**: a
>   két fuvar-részletoldal térképe mobilon (≤640 px) összecsukva indul, gombbal
>   nyílik (GF-020 hosszú mobil-oldalak). (3) **KYC előellenőrző tippek** a
>   feltöltő mező felett (elülső oldal, NE lakcímkártya, fény, 4 sarok,
>   név-egyezés); az elutasítás utáni „Újra próbálom" már élt. (4)
>   **Szállítói munkalista**: a vállalt fuvarok kártyáján „Következő:
>   …" (kézbesítés / felvétel / díjfizetésre vár / vita), a lista a teendő
>   szerint rendezve. (5) **Űrlap-piszkozat** a fuvarfeladáson
>   (localStorage, 7 nap, sikeres feladás törli; `lib/urlapPiszkozat.ts`)
>   + **`?next=`** a belépésen (csak belső, relatív cél —
>   `lib/navigacio.ts`, nyílt átirányítás ellen). ⚠️ htmlFor: a mért a11y
>   0 critical/serious (PR #177), a `<label>`-számlálás wrapping label-eket
>   talált — nem nyúltam hozzá.
> - **B3 ✅ (`audit-b3-szerkesztes-nudge.test.js`, web `idoablak.test.ts`;
>   082-es migráció a prodon LEFUTOTT):** (1) **`PATCH
>   /jobs/:id`** — a feladó a még nyitott (bidding/pending) fuvarján
>   javíthatja a címet, leírást, ajánlott árat, súlyt/méretet, felvételi
>   időablakot, cipelés/emelet/lift, deklarált értéket (a felvételi/lerakodási
>   cím NEM — arra tették az ajánlatokat); ugyanaz a validáció és
>   kontakt-szűrő, mint a feladásnál; a függő ajánlattevők `job_updated`
>   értesítést kapnak; a web fuvar-oldalon „Hirdetés szerkesztése” dialógus
>   (cím/leírás/ár). Eddig egy elgépelt ár csak lemondás + újrafeladással
>   volt javítható. (2) **Felvételi időablak** két `datetime-local` mező a
>   feladáson (opcionális; kliens-szabályok `lib/idoablak.ts`: nem múlt,
>   vége ≥ kezdet, ≤60 nap) és megjelenítés a szállítói fuvar-oldalon. (3)
>   **„Nincs ajánlat” nudge** (`services/noOfferNudge.js`, napi kör):
>   bidding + `NO_OFFER_NUDGE_AFTER_HOURS` (alap 24) + 0 ajánlat → EGYSZER
>   in-app + e-mail három tippel (ár +10–20 %, tágabb időablak, leírás +
>   fotó) és a szerkesztés linkjével; `jobs.no_offer_nudge_at` (belső
>   könyvelés — scrub + anonimizálás-manifest besorolva).
> - **C1 ✅ (backend P2; `audit-c1-backend-p2.test.js`, 7/8 piros a forrás
>   nélkül; 083-as migráció a prodon LEFUTOTT):** (1)
>   **lejárt azonnali fuvar** óránként NORMÁL ajánlatgyűjtésre vált
>   (`services/instantExpiry.js`, feladó értesül) — eddig örökre
>   „Ajánlatokat vár" maradt egy hirdetés, amit a feed nem mutatott; (2)
>   **webhook-indexek** (`escrow_transactions.barion_payment_id`,
>   `route_bookings.barion_payment_id`) + **messages XOR** (a photos-nak
>   volt, az üzeneteknek csak OR — prodon 0 kettős sor); (3) a
>   **lemondás-értesítés** linkje szerepkör szerint (a szállító eddig a
>   feladói oldalra kapott linket → 403); (4) **vita alatti kézbesítés**:
>   a feladó értesítést kap (eddig néma volt); (5) **kód-zár a WHERE-ben**
>   (zárolt soron a rossz kód 429, a számláló nem nő, a zár nem
>   hosszabbodik); (6) **SOS koordináta-kapu** (999-es szélesség → 400);
>   (7) a **sablon-járat** nem megy a `routes:new` feedbe; (8) **LIMIT** a
>   felhasználói listákon (ajánlataim 500, fuvar ajánlatai 200, járataim
>   500, foglalások 500, vitáim 200); (9) **CORS boot-ellenőrzés**
>   (`utils/corsOrigins.js`: élesben CORS_ORIGIN nélkül hangos hiba +
>   Sentry, a viselkedés marad); (10) `.env.example` az új hangolókkal.
>   ⚠️ TUDATOSAN NEM: `retention_runs` purge (a retenciós manifest indokolja:
>   elszámoltathatósági napló, ~3 sor/nap), a legacy `POST
>   /jobs/:jobId/reviews` törlése (három tesztfájl méri, a web nem hívja —
>   dokumentált legacy), halott státuszok (`pending`/`completed` az enumban:
>   ártalmatlan), Barion-kommentek (kozmetika), jobQuestions-naplózás (nem
>   volt PII-log).
> - **C2 ✅ (web P2; `noindex.test.ts` — a régi layoutokkal piros):** (1)
>   **noindex** minden privát/hitelesített szegmens layoutján (`robots:
>   { index: false, follow: false }`; új `app/dashboard/layout.tsx`, a
>   `sofor/layout.tsx` metadata-t kapott) — a robots.txt launchkori
>   `Allow: /`-jára készülve; a publikus oldalak nem kapnak noindexet (az őr
>   ezt is méri). (2) **Render-közbeni redirect → useEffect** (profil,
>   ai-chat, uj-fuvar). (3) **Fejléc fiókmenü** aria-label/haspopup/
>   expanded. (4) **GPS-prompt gombra**: a szállítói fuvar-lista NEM kéri
>   kéretlenül a helyet — a lista mindig betöltődik, egy sáv elmagyarázza
>   („csak a távolság kiszámításához, nem tároljuk"), a helyet gombra
>   kérjük; ha korábban engedélyezett, csendben használjuk
>   (`navigator.permissions`). (5) **Szűrők megőrzése** (localStorage, 30
>   nap, `urlapPiszkozat` helperrel). (6) **Értesítés-lapozás**: `GET
>   /notifications?before=<ISO>` kurzor + „Régebbi értesítések betöltése"
>   gomb (eddig a 100. után elérhetetlenek voltak). (7) **Support-sor a
>   láblécben** (info@ / panasz@ / AI-asszisztens — eddig SEHOL nem volt
>   látható elérhetőség). (8) CODEMAP: az új szolgáltatások (feePayment,
>   paymentReminders, noOfferNudge, instantExpiry, smsRetry, retention)
>   felvéve. ⚠️ TUDATOSAN NEM: dinamikus socket.io-client import (csak a
>   belépett oldalak bundle-jében van, a landingen nem), toast aria-live
>   (már volt: role=status + aria-live=polite, hibán role=alert),
>   e-mail-leiratkozás (csak tranzakciós levél megy; az útvonal-figyelő
>   saját kezelőfelülettel bír).
>
> **🔁 ÚJRA-AUDIT (2026-09-13) — ugyanaz a 4 lencse a friss main-en, 4
> ügynökkel; lelet: 3 P0 + 22 P1 + 74 P2 → D1–D4 csomagok (mind
> osztály-szintű zárás, őr-teszttel, ami a javítás nélkül igazoltan piros).**
> A user kérdésére („hiába javítunk, egyre több van?") a válasz: a P0-k
> mind a JÓL ISMERT mintából jöttek — „a védelem azon az úton épül meg,
> ahol felfedezték" —, ezért a D-csomagok nem tüneteket, hanem az
> OSZTÁLYT zárják (indok-mezők, fotótípusok, szűrő-orákulumok, ütemezett
> körök mind egy szabály alá). Jelentések: a session scratchpadjában
> (`audit2-{penz-ut,adatvedelem,web-ux,uzemeltetes}.md`) — a P2-listák
> (74 tétel) ott dokumentálva, nem javítva.
> - **D1 ✅ (adatvédelem / kikerülés osztálya, PR #232;
>   `audit-d1-kontakt-osztaly.test.js` 34 teszt, 27 piros a forrás nélkül):**
>   (1) **indok-kapu** (`ellenorizIndok`, utils/contactGuard): lemondás/
>   újranyitás indoka (fuvar + foglalás) opcionális, ≤500 kar., típus-kapu,
>   kontakt-szűrő — eddig szűretlenül ment a MÁSIK FÉL értesítésébe és a
>   `cancel_reason`-be (ingyen kontakt-csatorna); a `job:reopened` socket
>   nem viszi az indokot; a `cancel_reason` a díj előtti szállítónak és a
>   vesztes ajánlattevőnek nem jár. (2) **kontakt-szűrő bővítés**: link,
>   `www.`, csupasz domain (rövid TLD-lista; a Nagybetűs mondatkezdés a pont
>   után — „…4-kor.De…" — nem domain), Viber/WhatsApp/Telegram/Messenger/
>   Signal, `@handle`. ⚠️ Az E2E fogta meg: a „Hozasd el" flow a leírásba
>   írja a termék linkjét → a bolt-allowlist közös modulba került
>   (`utils/termekBoltok.js`, a link-előnézet és a szűrő ugyanazt olvassa;
>   a hasonmás „ikea.com.csalo.hu" nem bolt). (3) **fotó**: MINDEN
>   nem-hirdetési típus (`damage`/`document` is) csak `paid_at` után, fuvar +
>   foglalás — a díj előtt a szállítónál nincs csomag, a fotó csak
>   kontakt-csatorna lehetett (a régi „kár-fotó nem díj-függő" teszt-szabály
>   FELÜLÍRVA; a bizonyíték-garancia a díj után marad, lezárt fuvaron is).
>   (4) **GET /jobs orákulumok**: a város-szűrő számjegy nélkül mindkét
>   oldalon (a „utca 12/13" szondázás nem adja ki a házszámot); a haversine,
>   a távolság szerinti sorrend és a `distance_to_pickup_km` a 3 tizedesre
>   kerekített koordinátától, 0,1 km (trilateráció). (5) **GET /jobs/:id**:
>   nem nyitott fuvar teljes kívülállónak 404 (felek + ajánlattevő + admin
>   látja). (6) **barion_\*** (a feladó fizetési munkamenete) a szállítónak
>   sehol: mindkét scrub + `/jobs/:id/escrow`. (7) A címzetti felvételi
>   e-mail TÁRGYÁBAN nincs kód; a Sentry e-mail-riasztás tárgy-OSZTÁLYT kap
>   (idézet + számjegy nélkül); `maskInText` a csupasz 6 jegyű kódot is
>   maszkolja. (8) `GET /reviews`: `job_id`/`booking_id` csak a feleknek.
> - **D2 ✅ (pénz-út P1-ek, PR #233; `audit-d2-penz-ut.test.js` 8 teszt, 6
>   piros a forrás nélkül):** (1) a könyvelési mag whitelistje SQL-feltétel:
>   `accepted`, díjmentesen ÚJRANYITOTT `bidding` (`reopened_count > 0`),
>   és `disputed` CSAK ha a vita előtti állapot maga is várakozó — eddig a
>   reopen utáni késleltetett fizetés árva lett és a következő elfogadás új
>   munkamenetet nyitott (a feladó KÉTSZER fizetett); a lemondott→vitás
>   fuvar viszont fizetetté volt tehető. (2) **instant-accept
>   feeAlreadyPaid** (a licites ág párja): nincs új munkamenet, a kuponos
>   0 Ft marad, a `released` díj-sor nem íródik vissza `held`-re, a feladó
>   „már rendezve" értesítést kap. (3) SIKERES fizetés ismeretlen
>   PaymentId-vel → Sentry error (a pénz beérkezett, a platform nem
>   könyvelt — eddig egy `processed=false` naplósor). (4) **vita-kapu**:
>   csak `paid_at` + értelmes állapot (fuvar accepted/in_progress/delivered/
>   completed/cancelled; foglalás confirmed/in_progress/delivered/cancelled)
>   → 409 `DISPUTE_NOT_ALLOWED`: a fizetetlen fuvar egy-kattintásos
>   befagyasztása (griefing) és a nyitott hirdetés vitája zárva; a FIZETETT
>   lemondott ügyleten a vita marad (a mátrix korábbi szabálya). A
>   `teljes-ut` mátrix „vitát nyit" sorai igazítva (fizetetlen/nyitott
>   állapotban senki).
> - **D3 ✅ (web P1-ek, PR #234; web `ajanlat.test.ts`, `urlapPiszkozat`
>   +2, `MapCollapse` SSR, `ConfirmDialog` initialValues — 4 fájl piros a
>   forrás nélkül; backend `audit-d3-web-p1.test.js`):** (1) visszavont/
>   elutasított ajánlat után az űrlap újra látszik („Új ajánlat"; csak az
>   ÉLŐ saját sor tiltja — a B1-es „Visszavonom" után eddig SOHA nem
>   lehetett újra ajánlani, pedig a backend engedte). (2) „Hirdetés
>   szerkesztése": `ConfirmDialog.initialValues`, a cím nem kötelező, csak a
>   változás megy, a leírás törölhető. (3) „Beírom a javasoltat": a mező is
>   mutatja az árat (a rejtett állapotba került, a feladás láthatatlan
>   árral ment). (4) kuponos díjfizetés: `await loadAll()` (a
>   `router.refresh()` a kliens-állapotot nem frissítette) + a backend
>   kupon-ága `job:paid` socketet küld mindkét félnek. (5) a fuvarfeladás
>   piszkozata FELHASZNÁLÓHOZ kötött kulccsal + kijelentkezéskor törlés
>   (közös eszközön a B fiók az A feladó címzett-adatait kapta — a GF-006
>   osztálya). (6) a11y: emelet-select ×2, 6 szűrőmező, KYC fájl-mező, 5
>   céges regisztrációs mező `id`+`htmlFor`; az a11y-leltár 4 új
>   állapot-hookkal (cipelés-pipa, szűrők, „Cégként", KYC-modal). (7)
>   `MapCollapse`: az első render (SSR + effekt előtt) nem mountolja a
>   térképet. (8) telefon-kapu: a `DriverTermsGate` csak-telefon módban is
>   nyílik; a `PHONE_REQUIRED` az ajánlat-űrlapon BELÜL kér telefonszámot.
>   (9) `DisputeButton` a díj előtt rejtve.
> - **D4 ✅ (üzemeltetés P1-ek; `audit-d4-uzemeltetes.test.js` 16 teszt, 9
>   piros a meglévő fájlok javítása nélkül):** (1) **`services/utemezo.js`**
>   — MINDEN ütemezett kör közös burkolón (try/catch + Sentry a kör nevével
>   + átfedés-őr); a `.catch(() => {})` eddig elnyelte a KYC-purge, a
>   fizetési emlékeztető, a nudge, a DAC7 és az azonnali-lejárat hibáját
>   (a KYC-purge belül is nyelt → most továbbdob; a soronkénti hibák
>   `jelezSorHibak`-kal riasztanak). (2) **külső HTTP időkeret**
>   (`utils/httpIdokeret.js`, `KULSO_HTTP_TIMEOUT_MS`, alap 10 s): Resend
>   (kísérletenként), SeeMe, Expo push — eddig a 300 mp-es undici-alap volt
>   az egyetlen fék, az e-mail újrapróbával ~15 perc/levél, ami a soros
>   napi köröket órákra megállította. (3) **DB-pool időkeretek**
>   (`connectionTimeoutMillis` 5 s, `query_timeout` 30 s, `idleTimeoutMillis`
>   10 s — env-ből hangolható): a pg alapból ÖRÖKKÉ várt a Neonra. (4)
>   **bevezetés-dátum küszöb** a lejáratáson (`PAYMENT_EXPIRY_SINCE`,
>   2026-09-11) és a nudge-on (`NO_OFFER_NUDGE_SINCE`, 2026-09-12) — az első
>   éles futásuk a TÖRTÉNELMI adatokon cselekedett (2 régi elfogadott-
>   fizetetlen fuvar lezárva, 5 régi hirdetésre nudge-levél). ⚠️ SZABÁLY
>   MOSTANTÓL: új idő-alapú kör = `created_at >= <bevezetés dátuma>` (vagy
>   tudatos, egyszeri backfill-döntés + a PR-ben a prod-számlálás). (5)
>   **boot-idejű migráció-ellenőrzés** (`services/migracioEllenorzes.js`):
>   a `schema_migrations` sorai vs a fájllista — eltérésnél hangos log +
>   Sentry error (csak olvas, nem migrál). ⚠️ Nyitott user-döntés: a
>   2026-09-11-i első lejáratási kör által lezárt Manus QA-fuvar
>   (`8d53fbb6…`, „QA REGRESSZIÓ GF-009 — 300 KG") visszaállítása
>   `accepted`-re — kézi SQL, ha a Manus még használja.
>
> ⚠️ MUNKAMÓDSZER-TANULSÁGOK a körből: (1) a branch-védelem „naprakész ág"-at
> kér — egymásra épített PR-eknél minden merge után `git merge origin/main`
> + push a következő ágon, különben BEHIND; (2) a `gh pr checks --watch`
> néha az E2E befejezése ELŐTT kilép — a mergelést egy saját poll-ciklus
> végezze, ami addig vár, amíg nincs `pending`; (3) Python-szkriptben a
> magyar „…" idézőjel-pár záró `"`-je lezárja a dupla idézőjeles stringet —
> mindig háromszoros idézőjel, és a heredoc-ot NE `&&`-lánc mögé tedd
> (egy szkript-hiba után a teszt-fájl némán nem íródott ki, a vitest pedig
> a hiányzó fájlt szó nélkül kihagyta).
>
> **Launch-checklist (dokumentálva marad):** `ALLOW_STUB_PAYMENTS` törlése;
> stub-`sent` számlák takarítása; 13 migrációval igazolt teszt-fiók;
> adatkezelési mondat a zárolás miatt blokkolt törlésről; robots `Allow`
> napi SEO-tételek.

### 🔐 CODEX-AUDIT (2026-09-11) — 29 tétel, verifikálva; javítás FOLYAMATBAN

> A user feltöltötte egy másik modell (Codex „astra") teljes kód-auditját:
> 8×P0, 16×P1, 5×P2. **Négy ügynökkel + saját méréssel tételesen
> ellenőrizve: 21 teljesen igaz, 7 részben, 1 alpont hamis.** Öt olyan
> hibát talált, amit a korábbi 11 audit-kör nem: a migráció-újrafuttatást
> (P0-01), a járat-ág hiányzó kontaktfelületét (P0-07), a halott `can_bid`
> kaput (P1-03), a kupon kiiktatását a valódi /pay úton (P1-01) és a
> retenciós hamis `ok`-ot (P1-09). Pontatlan hivatkozásai: a socket-role
> nem JWT-ből jön (DB-ből, teszttel); a disputes XOR a reviews-migrációra
> mutat (a disputes máig OR); a „7 napos token" a session, nem a reset; a
> járat-létrehozás tiltja a múltbeli indulást (a foglalás nem); két kapun
> van dialog-szemantika; a hash scrypt, nem bcrypt. Tudatos döntés, nem
> hiba: disk-fallback riasztással (P0-05), publikus fotó-bucket (P1-08,
> Phase 6), localStorage-token (SEC-003), idempotencia (GF-003), lockfile,
> robots.txt, nem-fatális uncaughtException.
>
> **USER-DÖNTÉSEK (2026-09-11):** D1 a JÁRAT-ág a launchra ELREJTVE
> („hamarosan"; 9 tétel a 29-ből erre az ágra esett, üres járat-lista
> rosszabb üzenet, mint a hamarosan); D2 a kupon-sorrend a /pay-en
> JAVÍTANDÓ; D3 az ár-összehasonlító (2024-es GLS/MPL-árak, „Aznapi") LE
> — GVH-kockázat; D4 a szállító-felfüggesztés (`can_bid=false`) VALÓDI
> kapu legyen (ajánlat + járat + azonnali elfogadás tiltása); D5 az
> e-mail-kapu SZERVER-oldalon is az írási végpontokon; D6 a lockfile
> VERZIÓKÖVETVE.
>
> **Csomagok:** (1) ✅ PR #216 migráció-nyilvántartás + 034/061 egyszerivé + socket-
> payload scrub + admin szerepváltás session-visszavonással + e-mail-kapu
> POST /jobs, /bids, /bookings; (2) ✅ állapotgép-guardok (P0-04),
> törlés vs bizonyíték-zárolás (P0-06), `can_bid` kapu + KYC-név zár
> (P1-03), kupon-sorrend (D2); (3) ✅ retenciós `ok` általánosítása (P1-09),
> graceful shutdown + async scrypt + /health/ready; (4) ✅ web: járat-ág
> feature-flag mögé (D1), ár-összehasonlító ki (D3), SEO-apróságok
> (canonical www, title-duplázás, sitemap-dátum); (5) ✅ lockfile + `npm ci`
> + web tsc-kapu (D6). Launch-checklist bővül: a teszt-üzemben `sent`-re
> állt stub-számlák takarítása (P1-10), a 13 migrációval „igazolt" régi
> fiók (zömmel teszt) — döntés: nem nyúlunk hozzá, a teszt-adat
> takarítással megy.

### 📜 Lezárt tesztelői/audit-körök — a részletek a `CLAUDE2.md`-ben

> 2026-09-17-én a CLAUDE.md 258 KB-ra nőtt, ezért a lezárt körök teljes,
> változatlan szövege a **`CLAUDE2.md`**-be került (nem töltődik be
> automatikusan): a fizetési szöveg-elcsúszás (PR #186), a Manus
> biztonsági audit eredeti listája (2026-08-31), a Manus P1 célzott
> regresszió (3. futás) és a regressziós újrateszt (2. futás) feldolgozása
> + eredeti listái, a Manus-jelentés 24 tétele (2026-08-30), és a ✅ Kész
> (élesedett) tételes napló 2026-07-tól 2026-09-11-ig. Ha egy GF-/SEC-/
> REG-tétel vagy egy régi PR részlete kell: `grep -n "<kulcsszó>" CLAUDE2.md`.
> Ami máig ÉRVÉNYES szabály vagy tanulság, az lent, a ✅ összefoglalóban van.

### 🔐 MANUS BIZTONSÁGI AUDIT — FELDOLGOZVA (gyors kör + SEC-011 kész; session-kör tudatosan halasztva)

> **✅ AZONNAL JAVÍTVA (SEC-001, 002, 008, 009, 010):**
>
> - **SEC-001 + SEC-002 (web):** next.config headers — `frame-ancestors
>   'none'` + `X-Frame-Options: DENY` (clickjacking zárva) + nosniff +
>   Referrer-Policy + Permissions-Policy (geolocation=self — SOS/követés
>   használja). ⚠️ TELJES (script-src-es) CSP szándékosan NINCS még — az a
>   SEC-003-as session-körhöz tartozik (inline stílusok + Maps + socket).
> - **SEC-002 (API):** `X-Powered-By` kikapcsolva + nosniff/frame-deny/
>   referrer minden válaszon.
> - **SEC-010:** `Cache-Control: private, no-store, max-age=0` MINDEN
>   API-válaszon (a /uploads statikus út kivétel — az cache-elhető marad).
> - **SEC-008:** a gyökér a login `email.trim()`-je volt nem-string
>   inputon → 500. ⚠️ AZ ŐR-RÉS VOLT AZ ÉRDEKESEBB: a hülyebiztos-matrix
>   fuzz-céljai KÉZZEL VÁLOGATOTT sablon-listán futnak, és az
>   auth-végpontok nem voltak rajta — pont az az osztály, amit a matrix
>   elvben véd. A lista bővítve (login + forgot- + reset-password), a
>   login/forgot/reset típus-kapukat kapott; visszamérve: a fix nélkül a
>   bővített matrix piros.
> - **SEC-009:** lat [−90,90] / lng [−180,180] kapu az árbecslőn (a PR
>   #176-os fix a súlyt fedte, a koordinátát nem).
> - Őr: `sec-fejlecek.test.js` (fejlécek + no-store + uploads-kivétel +
>   koordináta-tartomány).
>
> **✅ SEC-011 KÉSZ (2026-08-31 este, user-döntés: „mehet"):** Next.js
> 14.2.5 → **16.3.3** + React 18 → **19.2** egy ugrással. A migráció
> meglepően kicsi volt, MERT az architektúra kliens-nehéz: a
> biztonság-kritikus logika a külön Express-backendben él, a Next főleg
> megjelenítő réteg — EGYETLEN szerver-komponens használt `params`-ot
> (a /fuvar/[utvonal] SEO-landing, async-ra írva), minden más oldal
> 'use client' + hookok (változatlan API). Mérések: tsc + build tiszta,
> web unit 117/117, 16-os oldal-leltár spec 52/52 (minden oldal renderel),
> konzol-tisztaság + téma + Enter-spec zöld. A függőség-audit 0 magas
> sérülékenységet jelez, a next/postcss ÍRÁSOS KIVÉTELEK TÖRÖLVE a
> fuggoseg-audit.js-ből (az őr maga jelezte: „már nem sérülékeny").
>
> **⏸️ SEC-003+004+005 (session-átépítés) — TUDATOSAN HALASZTVA
> (2026-08-31, user-döntés):** a localStorage-token ellopásához XSS vagy
> kompromittált script kellene — az audit egyiket sem találta, third-party
> script nincs, a stored-XSS zárva; a védelem határhaszna MA kicsi, az ára
> (web+mobile+socket auth-átépítés a frissen stabilizált belépés után)
> nagy. TRIGGER az újranyitásra: CIB-élesítés VAGY valódi felhasználói
> volumen — akkor HttpOnly refresh + 10-30 perces access + logout-
> visszavonás EGYÜTT, tervezett körben.
>
> Az EREDETI audit-lista (történeti): a `CLAUDE2.md` 2. részében.

### ✅ Kész (élesedett) — összefoglaló + a máig érvényes szabályok

> A tételes napló (minden PR, őr-teszt, saját hiba és tanulság 2026-07-tól
> 2026-09-11-ig, ~1700 sor) a `CLAUDE2.md` 6. részében van, változatlanul.
> Itt csak az marad, amit egy új session-nek a részletek nélkül is tudnia
> kell. Új tétel ide, a lista TETEJÉRE, RÖVIDEN; a hosszú indoklás a
> CLAUDE2.md-be.

**Ami él (időrendben visszafelé, csak a lényeg):**
- **Codex-audit 1–5. csomag (2026-09-11, PR #216-tól):**
  migráció-nyilvántartás (`schema_migrations`); állapotgép-guardok (feltételes
  UPDATE + 409 `STATE_CHANGED`); törlés vs bizonyíték-zárolás
  (`photo_retention_hold` blokkol); `can_bid=false` VALÓDI felfüggesztés
  (403 `CARRIER_SUSPENDED`); KYC-név zár (409 `KYC_NAME_LOCKED`);
  kupon-sorrend a /pay-en; a 22 retenciós kör továbbdobja a hibát
  (`retention_runs.ok` valódi); `/health/ready` + szabályos leállás + async
  scrypt; JÁRAT-ág feature-flag mögött (D1, `NEXT_PUBLIC_JARAT_ENABLED` +
  `JARAT_ENABLED`, alapból KI); ár-összehasonlító törölve (D3, GVH); SEO
  (www canonical, title-duplázás); lockfile verziókövetve + `npm ci` + web
  tsc-kapu (D6). Őrök: `migracio-ujrafuttatas-or`, `allapotgep-guardok`,
  `torles-vs-zarolas`, `szallito-felfuggesztes`, `kyc-nev-zar`,
  `kupon-pay-sorrend`, `retencio-ok-hamis-zold`, `health-ready`,
  `funkcio-kapcsolo-jarat`, web `features.test.ts`.
- **Díj látható a döntés előtt** (feladási űrlap, minden ajánlat-kártya,
  fizetés-kártya; web-tükör `lib/connectionFee.ts`, őr:
  `dij-sav-web-szinkron`) + **SMS „csak átadáskor" mondat** (3 szegmens) +
  **készpénz VAGY átutalás** szöveg 45 helyen (mind 2026-09-10; szabályok az
  5. szakaszban).
- **SMS-kiesés végleg megoldva (2026-08-30):** SeeMe IP-szűrőben a TELJES
  tartomány; `sms_retry_queue` (079) 48 órán át 10 percenként újrapróbál
  (`services/smsRetry.js`, csak szó szerinti továbbítás); code=13/7-nél
  e-mail az info@-ra is. Őr: `sms-ujrakuldesi-sor`.
- **Manus-körök (2026-08-30/31, PR #189–#207 között):** időkeret minden fetch-en
  (`fetchWithTimeout`, 15 s; feltöltés 60/90, AI 45); regisztráció/ajánlat
  cold-start-helyreállítás (35 s + csendes belépési próba / „létrejött-e
  közben?"); mód a user id-jával kulcsolva + szerver-adatból inicializál;
  socket újrakötés belépéskor (`refreshSocketAuth`); utca-szint + ~110 m
  koordináta a díj előtt MINDEN listán/feeden (`utcaSzint`); vészkód csak
  `paid_at` után; along-jobs kapacitás-szűrő; címzett-e-mail validálva;
  Next 14 → **16.3.3** + React 19 (SEC-011); biztonsági fejlécek +
  `no-store` (SEC-001/002/010); login típus-kapuk (SEC-008); koordináta-kapu
  az árbecslőn (SEC-009). A SEC-003/004/005 session-átépítés TUDATOSAN
  halasztva (trigger: CIB-élesítés vagy valódi volumen).
- **Akadálymentesítés + halott linkek mérve (PR #177):** 0 critical/serious
  50 oldal-állapoton, 0 halott belső link; közös `e2e/oldal-leltar.ts`.
- **CI-kapu javítva (PR #176):** a backend teszt-lépés 2026-08-12-ig NEM
  kapuzott (a `pg.stop()` felülírta a kilépési kódot) — `ci-kapu-or.test.js`
  őrzi. Lefedettség sorok 93,6 % / elágazások 86,5 %, padló 90/89/84/83
  (`scripts/lefedettseg-or.js`; a vitest saját thresholds-a NEM kapuz).
  Menet közben 3 termékhiba: szállítói „Nettó bevétel" escrow-képlettel,
  SOS (0,0) koordinátára, árkalkulátor `Infinity`/negatív súlyra.
- **11 adatvédelmi mérési kör (2026-08-09 → 08-12, PR #139–#174):** minden
  adattípus retenciója gépesítve + manifest-őrök (retenciós minden táblára,
  anonimizálási OSZLOPONKÉNT, PII-csatorna minden hitelesített GET-re +
  socket + push, Sentry-boríték minden `beforeSend*` hookra, SMS-szegmens,
  megőrzési-idő horgony 14 értékre); okmány-lenyomat HMAC (sózatlan
  kinullázva, 073); socket-szoba jogosultság VALÓDI kapcsolattal mérve;
  fiók-törlés R2-takarítással; `retention_runs` + 48 órás watchdog; publikus
  követő-link 14 nap + minden státuszra lejár; `messages.recipient_id`.
  Dokumentumok: `docs/adatvedelem/` (DPIA, 30. cikk, érdekmérlegelés,
  incidensterv — ügyvezetői jóváhagyásra várnak).
- **Biztonsági mélyaudit + 2. kör (2026-08-09):** kontakt-szűrő
  MINDEN díj előtti szabad szövegen (név, cím, leírás, ajánlat, járat, bio,
  vita-leírás, értékelés); `recipient_*` és a saját vészkód csak `paid_at`
  után; publikus `/tracking/:token` `paid_at` mögött; along-jobs/backhaul
  scrubbal; **Barion VÉGLEG törölve**, provider-független
  `confirmFeePayment`, default `cib`, ismeretlen provider = hangos hiba;
  stub-fizetés élesben FUTÁSIDEJŰ biztonságos mód (kézi nyugtázás + callback
  zárva); feed-szoba csak hitelesítve; dupla-számla UNIQUE (057); mentős
  (towing) végpontok kapuzva (a funkció UI-ja dormant); DB-pool 30.
- **Teszt-rétegek (2026-08-06/07):** `hulyebiztos-matrix` (SZ1 soha 500 /
  SZ2 zárt / SZ3 titok / SZ4 nincs belső részlet; `routeManifest` — új
  végpont manifest nélkül = piros), `query-string-matrix`,
  `szerep-lefedettseg` (minden végpont a jogosult szereplővel, KIVETELEK
  listával), `teljes-ut` (állapot × szereplő × művelet mátrix, fuvar +
  foglalás), `feketedoboz-ut` (SQL-fixtúra nélkül, a levélből olvasott
  linkkel), web `16-oldal-lefedettseg` (önvédő leltár-őr), `17-urlap-
  hibauzenetek`, `13-szovegor`, `14-konzol-tisztasag`; mutációs (Stryker,
  NEM CI, ~1 óra); függőség-audit + lefedettség-őr a CI-ban; teszt-harness
  egyetlen figyelő szerverrel (`tests/helpers.js` `app`/`expressApp`);
  `web/scripts/ai-tesztelo.mjs` LLM-felderítő (nem CI, élesbe soha).
- **Termék (2026-07 → 08):** ellenajánlat-alku (Vinted-stílus); „Hozasd el"
  (termék-link → OG-előnézet → fuvar, a kép a szállítóig; bolt-allowlist
  `utils/termekBoltok.js`); visszaszállítási nyilatkozat; DeliveryPin
  (QR KIVEZETVE 2026-08-06); admin v2 6 füllel + admin↔user üzenet +
  körüzenet + élő jelenlét + aktivitás-napló + KYC-felület; ajánlói program
  (link + beírható kód; jutalom = EGY ingyenes kapcsolatfelvétel); okos
  árazás (~90 Ft/km); lane-alert (e-mail + in-app); téma-kapcsoló
  (`<html data-theme>`); PWA; SEO-landingek (`lib/landings.ts`: 5 útvonal +
  célközönség + 5 use-case; útvonal-oldalból többet NEM gyártunk); zöld
  pozicionálás (`lib/green.ts`); fuvarozók toborzó-oldal; design-polír 1–2.
  kör (EmptyState/ListSkeleton, type-scale, lucide, világos fejléc);
  felvételi időablak; hirdetés-szerkesztés; nincs-ajánlat nudge.
- **Integrációk:** Resend ✅ (DKIM/SPF/DMARC), ImprovMX bejövő ✅, Sentry ✅
  (közös scrub, `beforeSend*` mind szűrt), SeeMe SMS ✅ (kulcs rotálva),
  privát KYC-bucket ✅ + magic-byte kép-ellenőrzés, Google Maps `hu`/`HU`,
  Számlázz.hu KÓD KÉSZ (bruttó díj, Agent-kulcs hiányzik — aktiválás a 🟡
  szakaszban), NAV „Ellenőrzött cég" KÓD KÉSZ (technikai user hiányzik),
  CIB vPOS skeleton (`services/cib.js`), DAC7 adóazonosító-gyűjtés ✅ (051),
  KYC/fotó/chat/GPS retenció ✅, Node 24 a Railway-en.
- **Alap (2026-07 elejéig):** web app, backend Railway, migrációk, ÁSZF +
  GDPR EU-kiegészítéssel, kemény e-mail-verify kapu (PR #68), szállítói
  KRESZ-nyilatkozat (PR #67), feladói KYC-mentesség (PR #96), egyszerűsített
  árazás (PR #87), mód-alapú fejléc (PR #86), „Szállító" + „Járat" átnevezés
  (PR #90), „licit" kivezetve (PR #71), 1 db SMS-modell, coverage Európa,
  AI chatbot, admin CRUD, dispute/review/chat, GPS-backend („Hamarosan").

**Szöveg-szabályok (a `web/e2e/13-szovegor.spec.ts` méri a marketing-
oldalakon; a jogi oldalak kivételek):** user felé TILOS: „licit/licitálás"
(→ ajánlat/ajánlattétel), „sofőr" (→ szállító), „fix áras útvonal" (→ járat),
„QR" (csak a 6 jegyű PIN; a QVIK fizetési QR más fogalom), „letét",
„GoFuvar Kft." (→ Tiszta Hód Kft.), app-ígéret (nincs app — „e-mailben
szólunk"), „jogosítvány nem kell" a marketingben, „biztonságos fizetés",
„sikeres fuvar után fizetsz" (a díj az elfogadáskor esedékes), „gyakran
olcsóbb, mint egy dedikált cég/futár", kvantifikált „ennyi Ft üzemanyagot
keres", „te szabod az árat" (→ „A szállító ajánl, te döntesz"), és minden
készpénz-szűkítés (5. szakasz). Élő GPS mindenhol „Hamarosan". Kód-belső
nevek (bids, driver/carrier, `/sofor/*`, `?tab=licitjeim`) és az ÁSZF
definiált fogalmai NEM változnak. Emoji UI-ikonként TILOS (lucide).

**Fejlesztési / tesztelési szabályok (a napló tanulságai):**
- Minden javításhoz ŐR-TESZT, ami a javítás NÉLKÜL igazoltan piros — enélkül
  az őr csak dísz. Piros-próba ELŐTT commit vagy stash, SOHA
  `git checkout <branch> -- fájl` (egyszer így vesztek el a javítások).
- Minden kapunál mérd le, hogy a bukás TÉNYLEG megbuktatja a buildet —
  „fut a CI-ben" ≠ „kapuz" (a backend-suite 2026-08-12-ig vak volt).
- „A védelem azon az úton épül meg, ahol felfedezték" — mindig az OSZTÁLYT
  zárd (REST + socket-payload + push + export + feed + írási végpont
  VÁLASZ-törzse), ne a tünetet. Ha egy szabályt egy helyen alkalmazol,
  keresd meg az egyenértékű utakat.
- Audit-ügynöktől ELLENPÉLDÁT kérj („melyik sort vegyem ki úgy, hogy a
  tesztek zöldek maradnak"), ne véleményt; több lencse (séma / adatáramlás /
  jogi / üzemeltetés) — egy szemszög strukturálisan vak. Szöveg-illesztő őrt
  egy KOMMENT is kielégíthet — futtatás-alapú őr kell.
- Ügynök-munka: csak ÚJ tesztfájl, termékkód-hibát JELENT (a parent javít),
  minden teszthez „ez akkor bukna el, ha…"; párhuzamos futás
  `GOFUVAR_TEST_PG_PORT`-tal (alap 54331).
- Külső tesztjelentésnél MINDIG vesd össze a teszt időpontját a
  deploy-időbélyeggel, MIELŐTT javítasz (a Manus kétszer deploy előtti
  bundle-t mért).
- Meglévő teszt is kodifikálhatja a HIBÁT („így működik" vs „így KELL") —
  ha a javítás régi tesztet buktat, előbb a teszt szabályát kérdőjelezd meg
  (listing-fotó purge, pontos cím a böngészőnek, egyszer használatos
  verify-token — mind ilyen volt).
- `vi.spyOn().mockRejectedValue()` NEM mér kezeletlen elutasítást — nyers
  metódus-csere kell (`mock-csapda-or`). Versenyteszthez ≥ 8 szál (2 szál
  hamis zöld). A Playwright bukás után újraindítja a workert — modul-szintű
  gyűjtés elveszik (fájlba írd, törlés a `globalSetup`-ban). Új `page.tsx`
  = `e2e/oldal-leltar.ts`-be (az őr megírja a sort).
- SQL egy JS template literal belsejében: backtick és `//` a kommentben
  TILOS (háromszor történt meg; őr méri). Migráció: DDL és a rá épülő
  DML/INDEX KÜLÖN fájl (a futtató a teljes fájlt EGY lekérdezésként adja
  át); sémát NE tippelj — kérdezd le előtte; már lefuttatott fájlt nem
  szerkesztünk (3. szakasz).
- Manifest-őrök, amik új kódnál piros buildet adnak: új végpont →
  `tests/routeManifest.js` + `szerep-lefedettseg`; új `jobs`/`route_bookings`
  oszlop → scrub-ALLOWLIST + `tests/anonimizalasManifest.js`; új tábla →
  retenciós manifest; új hitelesített GET → PII-csatorna besorolás
  (`masok` = futásidejű kapu-ellenőrzés); új ütemezett kör →
  `services/utemezo.js` burkoló + KOR_NEVEK + `created_at >=` bevezetés-
  dátum; új Sentry-init → közös scrub minden `beforeSend*` hookon.
- Teszt-env: az éles kulcsokat ÜRES STRINGRE állítjuk, nem `delete`-tel (a
  dotenv visszatölti — a suite egyszer az ÉLES R2-be írt);
  `teszt-kornyezet.test.js` őrzi. A prod Neont teszt SOHA nem éri el.
- `shared/` csak tesztekből hivatkozható, éles kódból SOHA (9. szakasz).

**Termék- / állapotgép-szabályok (mind őr-teszttel):**
- Kézbesítés felvételi fotó nélkül tilos (`PICKUP_REQUIRED_FIRST`); lezárt
  fuvarra GPS 409 `JOB_CLOSED`; `disputed` ÁTMENETI (`status_before_dispute`,
  053), vita alatt NINCS lemondás, a kézbesítés folytatódhat (a `disputed`
  marad); reopen-plafon 5 (`REOPEN_LIMIT_REACHED`); párhuzamos elfogadásnál
  előbb MINDIG a fuvar sora zárolódik (deadlock ellen).
- Kontakt-szűrő (`detectContactLeak` / `firstContactLeak`) csak a díj ELŐTT
  fut (utána a telefonszám legitim bizonyíték) — kivétel az értékelés-
  komment (mindig szűrt) és a telefon/rendszám mező (sosem). Személynévben
  nincs számjegy (`NAME_HAS_DIGITS`). Foglalás feladói `delivery_code`-ja
  marad díj előtt is (a foglalásnak EGY kódja van — dokumentált külön döntés).
- E-mail-verify token v2: determinisztikus HMAC, idempotens, az újraküldés
  UGYANAZT a linket viszi (linkszkenner-biztos). Belépés/regisztráció 35 s
  kerettel + időtúllépés után csendes belépési próba; navigációs watchdog.
- Enter a címmezőkben SOHA nem submitol; a kijelölt javaslat a SAJÁT
  Geocoder-feloldáson megy át (`resolveText`) — a Places legördülő magyar
  címre nem ad házszámos javaslatot, a Geocoder a mentőág; házszámig pontos
  cím kötelező (`requirePrecise`). Szám-mezők: negatív be sem írható (jelzéssel),
  tört cm/Ft látható hiba, néma átalakítás TILOS; ár-minimum figyelmeztetés
  NEM kell (user, 2026-08-30).
- Ajánlói jutalom = EGY ingyenes kapcsolatfelvétel (nem pénzérték, mindkét
  sávra, egyszer; `max_fee_huf` NULL); trigger a fizetési NAPLÓ (>0 Ft),
  havi plafonnál HALASZTOTT; sofőri szint-kupon dormant.
- Felhasználó magától NEM írhat az adminnak — csak közvetlen admin-üzenet
  nyit csatornát (körüzenet nem; 403 `NO_CHANNEL`). `users.role` NEM
  szegmentálásra való: a szállítói működés jele `driver_terms_accepted_at`,
  a feladóié a fuvar-előzmény.
- KYC: az AI `valid:true` mellett 4 kockázati jel emberhez terel (bizalom
  < 0,85, név-eltérés, másolat-gyanú, olvashatatlan okmányszám —
  `services/kycReview.js`); duplikátum-okmány és korábban törölt fiók →
  emberi ellenőrzés; lakcímkártya SOHA. Admin/self-delete: aktív+fizetett
  vagy vitás vagy zárolt ügyletnél tilos (`userHasBlockingDealings`).
- Címzett-telefonszám minimum 9 számjegy (a tesztelő 10-et javasolt; user:
  „egyelőre hagyjuk"). Nyitott user-döntés: a 2026-09-11-i első lejáratási
  kör által lezárt Manus QA-fuvar (`8d53fbb6…`) visszaállítása `accepted`-re
  — kézi SQL, ha a Manus még használja (D4). A referral-plafon kérdése
  ZÁRVA: halasztott jutalom, nem elvesző (A2).

**UI / infra-tanulságok:**
- Dark mode a `<html data-theme>` attribútumon (nem media query; a
  `THEME_BOOT_SCRIPT` szándékos duplikátum, a `theme.test.ts` futtatja).
  Google Maps API + InfoWindow NEM ért CSS-változót (literál hex); a
  Maps-loader opciói (`lib/maps.ts`: `language: 'hu'`, `region: 'HU'`)
  MINDEN betöltésnél azonosak legyenek, különben újratöltési hiba.
- globals.css: `input { width:100% }` alól checkbox/radio kivétel (PR #186 —
  a consent-szöveg betűnként tört); dekor-elem ne nyújtsa a dokumentumot
  (`overflow-x: clip`, NEM hidden — sticky fejléc; 11-es spec); inline
  `display` felülütné a témaváltást (logó-pár CSS-ből); a `.card`
  `overflow-wrap: anywhere` öröklődik.
- Böngésző-konzol: a kezelt 4xx normális, az 5xx SOHA (16-os spec); a
  `suppressHydrationWarning` a `<html>`-en a téma miatt (14-es spec).
- A Neon keep-alive ping NE kerüljön vissza (kvóta-kifutás volt); a
  cold-start valódi megoldása fizetős (Neon autosuspend ki / Railway min.
  példány — user-döntés). DB-pool 30 (`DB_POOL_MAX`), pool-időkeretek env-ből.
  Stub-fizetés élesben `process.exit`-tel NEM védhető (10 perces 502-ciklus
  volt) — futásidejű biztonságos mód, feloldó env-kapcsoló SZÁNDÉKOSAN nincs
  (kivéve a tudatos `ALLOW_STUB_PAYMENTS` teszt-üzem, lásd 🚨 szakasz).
- Railway CSAK a `backend/`-et deployolja; `.node-version` = 24; a
  `packageManager` mező a Railpackkel NEM működött; lockfile commitolva =
  a végleges védelem a registry-változás ellen.
- SMS ár-terv: ~57 Ft/fuvar 3 szegmensen (név 14 karakterre vágva);
  volumen-felfutásnál (50–100e Ft/hó SMS-számla) ≤70 karakteres, 1
  szegmenses változatra váltunk (~5 perces módosítás a photos.js két
  pickup-üzenetében). Rövidebb SMS-t az őr (`sms-szegmens-or`) mér.
- Terheléses mérés (k6, `backend/scripts/load-teszt.js` + `plafon-teszt.k6.js`):
  nyers plafon ~500–600 req/s a `/health`-en, DB-kötött végpontok ennek
  töredéke; a globális limit 300 kérés/perc/IP; a prodot CSAK ~0 usernél
  stresszeld. Éles füstteszt deploy után: `node scripts/eles-fustteszt.js`.

### 🚨🚨🚨 LAUNCH ELŐTT KÖTELEZŐ — A TESZT FIZETÉSI ÜZEM KIKAPCSOLÁSA 🚨🚨🚨

> **`ALLOW_STUB_PAYMENTS` = TÖRLENDŐ A RAILWAY ENV-BŐL A LAUNCH ELŐTT.**
>
> **EZ A LEGELSŐ TEENDŐ AZ ÉLESÍTÉSKOR — MINDEN MÁS ELŐTT.**
>
> **MI TÖRTÉNIK, HA BENT MARAD:** BÁRKI fizetés nélkül „fizetettnek"
> jelölheti a SAJÁT fuvarát, és ingyen megkapja a szállító elérhetőségét.
> **A PLATFORM EGYETLEN BEVÉTELE (a kapcsolatfelvételi díj) TELJESEN
> MEGKERÜLHETŐ.** Nem részlegesen — teljesen.
>
> **MIÉRT VAN EGYÁLTALÁN BEKAPCSOLVA (2026-08-15, user-döntés):** a védelem
> mellékhatása az volt, hogy a fizetés UTÁNI fél rendszer (felvétel, átvételi
> kód, kézbesítés, értékelés, vita) élesben EGYÁLTALÁN nem tesztelhető, amíg a
> CIB nem él — a tesztelő ezen elakadt. A user döntése: kapcsoljuk ki, a
> launchnál vissza. Az aggály (hogy elfelejtve bent marad) ettől NEM szűnt meg.
>
> **AMI NEM AZ EMLÉKEZETRE ÉPÜL:**
> 1. minden boot-nál hangos hibalog + **Sentry-riasztás** (`error` szinten);
> 2. **LÁTHATÓ, sárga „TESZT FIZETÉSI MÓD" sáv** a fizetési kártyán és a
>    stub-oldalon (`TesztFizetesSav.tsx`) — ha bent maradna élesben, egy
>    VALÓDI FELHASZNÁLÓ is azonnal látja. Ez a legerősebb védelem, mert nem
>    kell hozzá senki figyelme;
> 3. ez a szakasz, a launch-kapu lista ELŐTT.
>
> **AMIT A KAPCSOLÓ SZÁNDÉKOSAN NEM NYIT KI:** a `/payments/*/callback`
> PUBLIKUS webhookot. A kézi nyugtázás hitelesített, és csak a SAJÁT fuvarodra
> hat; a callback viszont hitelesítés nélküli, ott egy hamisított POST BÁRKI
> fuvarját fizetettnek jelölhetné. Őrzi: `tests/teszt-fizetesi-uzem.test.js`.
>
> **ELLENŐRZÉS ÉLESÍTÉS UTÁN:** a fizetési kártyán NEM szabad látszania a
> sárga sávnak. Ha látszik, az env még bent van.
>
> **UGYANEKKOR KÖTELEZŐ: TESZT-ADAT TAKARÍTÁS (Manus GF-011, 2026-08-30).**
> A teszt-üzem alatt feladott teszt-fuvarok (1 Ft-os, 1×1×1 cm-es tételek,
> Manus/tesztelő fiókok hirdetései) a NYITOTT piactérben látszanak — launch
> előtt a prod DB-ből törlendők (a tesztelő-fiókokkal együtt eldöntendő:
> törlés vagy megtartás). ⚠️ ADDIG NE töröld őket, amíg a Manus-körök
> futnak — a tesztelő fiókjai szándékosan érintetlenek, hogy újra végig
> tudjon menni a folyamaton.

### 🔴 Launch-kapu — adatvédelmi/jogi ellenőrzőlista (2026-07-18 felmérés)

> **A launch-előkészítésnél (QVIK-élesítés környékén) ezt a listát KÖTELEZŐ
> felhozni a usernek, és tételesen végigmenni rajta.** A 2026-07-18-i
> jogi-adatvédelmi átvilágítás eredménye: az érdemi gyakorlat (retenció-
> automatika, minimalizálás, privát KYC-bucket, scrub-tesztek) erős — a
> FORMÁLIS jogi réteg hiányos, egy NAIH-vizsgálat ma találna hibát.

1. ~~Gemini API számlázási szint~~ → **ELLENŐRIZVE, RENDBEN (2026-07-22,
   user megerősítette)** — a KYC-okmányfotók a Google AI Studio API-ra
   mennek (`GEMINI_API_KEY`, `services/gemini.js`). A projekt a Google
   Cloud Console Billingjén havonta VÁLTOZÓ, valódi díjat mutat (pl.
   $0,03) → ez csak fizetős (pay-as-you-go, billing-engedélyezett)
   projektnél lehetséges (ingyenes szinten sosem keletkezik számlázott
   tétel). Fizetős szinten a Google NEM használja a beküldött tartalmat
   termékfejlesztésre → a KYC-okmányfotókra ez jogilag rendben van, a
   dpia-kyc.md 2. kockázatának feltétele teljesül
2. ~~DPIA (adatvédelmi hatásvizsgálat, GDPR 35. cikk)~~ → **MEGÍRVA
   (2026-07-20, `docs/adatvedelem/dpia-kyc.md`), ügyvezetői jóváhagyásra
   vár.** Az AI-alapú okmányelemzésre; 8 azonosított kockázat +
   intézkedés (a Gemini-fizetős-szint a maradék-kockázat feltétele —
   lásd 1. pont); az élő GPS (mobil-fázis) előtt KIEGÉSZÍTŐ DPIA kell,
   ez a dokumentum azt külön jelzi
3. ~~GDPR 30. cikk nyilvántartás~~ → **MEGÍRVA (2026-07-20,
   `docs/adatvedelem/gdpr-30-cikk-nyilvantartas.md`), ügyvezetői
   jóváhagyásra vár.** 13 adatkezelési tevékenység tételesen (cél,
   jogalap, adatkör, címzettek, megőrzés, TOM) — minden bevezetéskor
   frissítendő (élő GPS és DAC7 még placeholder-sorként szerepel, mert
   nem élesek)
4. **JSON-adatexport — a tájékoztató ígéri, de NINCS megépítve.** Az
   érintetti jogoknál szerepel az adathordozhatóság „strukturált, géppel
   olvasható (JSON)" kiadása, de export-végpont nem létezik. Vagy kis
   végpont, vagy tudatos kézi folyamat (SQL-ből, 30 napos határidő!)
5. ~~Érdekmérlegelési tesztek~~ → **MEGÍRVA (2026-07-20,
   `docs/adatvedelem/erdekmerlegelesi-tesztek.md`), ügyvezetői
   jóváhagyásra vár.** 3 teszt: szállítói okmány-azonosítás (I.),
   doc_number_hash 5 éves csalásvédelmi megőrzés (II.), fotó/chat
   bizonyíték-zárolás vitás ügyleteknél (III.) — lásd 11. pont is
6. **Adatfeldolgozói szerződések (28. cikk) tételes ellenőrzése.** A
   tájékoztató állítja, hogy mindenkivel van DPA; a nagy SaaS-eknél (Neon,
   Cloudflare, Resend, Sentry, Google) a ToS/DPA általában fedi — a
   **SeeMe-nél (magyar cég) külön ellenőrizendő**, van-e írásos DPA
7. ~~Incidenskezelési terv~~ → **MEGÍRVA (2026-07-20,
   `docs/adatvedelem/incidenskezelesi-terv.md`), ügyvezetői jóváhagyásra
   vár.** 72 órás NAIH-bejelentési lépéssor, kockázat-szintek, szerep-
   mátrix, érintett-értesítési sablon, incidens-napló-kötelezettség
8. ~~Sentry `beforeSend` minimális~~ → **JAVÍTVA (2026-07-22, PR #98)**:
   közös scrub (`backend/src/utils/sentryScrub.js` +
   `web/src/lib/sentryScrub.ts`) mindhárom Sentry-initben (backend, web
   kliens, web szerver — utóbbin EDDIG SEMMILYEN szűrés nem volt!):
   request body egészében eldobva, URL/query/breadcrumb token-paraméterek
   kitakarva (jelszó-reset + email-verify élő tokenjei!, /tracking és
   /nyomon-kovetes útvonal-tokenek), auth/cookie fejlécek törölve.
   +16 teszt. A scrub sosem dob (hibánál az eredeti eseményt engedi át)
9. **Ügyvédi review** az AI-írta jogi szövegekre (Phase 6-on rajta van,
   a 4 új dokumentumra IS kiterjed) — ez a végső pecsét; addig „teljesen
   jogszerű" kijelentés NEM tehető
10. **DAC7 platformüzemeltetői kötelezettségek** — a GoFuvar az Aktv.
    (DAC7) szerint platformüzemeltető, a szállítók „értékesítők" (személyi
    szolgáltatás: fuvarozás — NINCS de minimis mentesség: 1 teljesített
    fuvar is jelentendővé tesz!). Állás:
    (b) ~~adóazonosító-gyűjtés~~ → **MEGÉPÍTVE (2026-07-22, PR #99,
    Vinted-minta)**: magánszemély szállítótól az ELSŐ teljesített fuvar
    után kérjük (adóazonosító jel checksum-validálva + születési dátum +
    lakcím; profil-kártya + HomeHub-banner + email), 21 naponta max 2
    emlékeztető (napi job), 2 emlékeztető + 60 nap után az új ajánlattétel
    blokkolva (TAX_DATA_REQUIRED a requireDriverKYC-ben) — a megadás
    azonnal felold; cégnél az adószám a TIN (már gyűjtött, nem érintett);
    051 migráció (prodon lefutott).
    MÉG NYITOTT: (a) NAV platformüzemeltetői BEJELENTKEZÉS (user-teendő,
    ügyfélkapu; a kötelezettség keletkezésétől 45 nap — gyakorlatban a
    launch körül); (c) éves adatszolgáltatás a NAV-nak (első jelentés a
    launch-évet követő január 31. — a jelentés-generálót addig kell
    megépíteni, az adatok már gyűlnek). Szankció: 2 M Ft-ig, felhívás
    után 5 M Ft-ig terjedő mulasztási bírság. Pozitívum: a DAC7 törvényi
    adatgyűjtési kötelezettsége egyben a szállítói KYC egyik jogalapja is
    (GDPR 6(1)(c))
11. ~~Okmány-fotózás érdekmérlegelési teszt~~ → **MEGÍRVA, lásd 5. pont**
    (`docs/adatvedelem/erdekmerlegelesi-tesztek.md` I. teszt) — a
    NAIH-főszabály szerint okmányt másolni külön törvényi felhatalmazás
    nélkül főszabály szerint tilos, MÉG HOZZÁJÁRULÁSSAL IS; a jogalap a
    jogos érdek (távoli kontextusban a fénykép az egyetlen működő
    azonosítás), a teszt rögzíti miért nincs enyhébb mód + a garanciákat
    (30 napos törlés, privát bucket, emberi döntés, nincs biometria).
    ⚠️ SZABÁLY (VÁLTOZATLAN): LAKCÍMKÁRTYÁT SOHA ne kérjünk (hátulján a
    személyi azonosító — 1996. évi XX. tv. szerint csak törvényi
    felhatalmazással kezelhető); csak személyi igazolvány

**Állapot (2026-07-20 után):** a 2+3+5+7+11 pontok dokumentum-szinten
KÉSZEK (`docs/adatvedelem/`, lásd az ottani README-t) — ügyvezetői
jóváhagyásra (aláírás/dátum a dokumentumok záradékában) és a tervezett
ügyvédi review-ra várnak, utána tekinthetők lezártnak. Élesben nem
változtatnak semmit — belső, nem publikus anyagok. Maradék munka:
1. pont (perces ellenőrzés), 4. pont (kis végpont/folyamat-döntés),
6. pont (SeeMe DPA-ellenőrzés), 10. pont (adóazonosító-mező +
NAV-ügyintézés), 9. pont (ügyvédi review, Phase 6).

### 🟡 Várakozóban
- **FIZETÉS: QVIK-re váltás (2026-07-08 döntés)** — a Barion drága; a
  kapcsolatfelvételi díjat **QVIK-kel** (magyar azonnali fizetés, QR /
  request-to-pay, ~0,4–0,8% díj, azonnali jóváírás, nincs chargeback) szedjük.
  **ELŐKÉSZÍTVE + MERGELVE (PR #69, 2026-07-09; a qvik-callback a prodon él):**
  `services/paymentProvider.js` absztrakció
  (a `PAYMENT_PROVIDER` env váltja: barion|qvik; a jobs/bids ÉS a
  route-bookings/Járat-fizetés is ezen megy — utóbbi 2026-08-08-án
  igazítva ide, addig tévesen közvetlenül a barion-t hívta),
  `services/qvik.js` stub + dokumentált TODO-k, `/payments/qvik/callback`
  route-skeleton. **AKTIVÁLÁS amikor megjön a jogosultság:** (1) töltsd ki a
  `qvik.js` `startFeePayment`+`getPaymentState`-jét a PSP API-jával; (2) állítsd
  be `PAYMENT_PROVIDER=qvik` + `QVIK_API_KEY`/`QVIK_MERCHANT_ID`/`QVIK_BASE_URL`
  a Railway-en; (3) kösd be a qvik-callback feldolgozását (a Barion-callback
  27–291. sorát javasolt közös `confirmFeePayment` helperbe kiszervezni).
  **2026-07-11 user-döntés: a Barion VÉGLEG ELVETVE** ("meguntam a velük lévő
  harcot") — a Barion-kód csak dormant maradvány, NEM élesítendő; Barion-
  szerződés és Barion Pixel okafogyott.
  ⚠️⚠️ **2026-08-08 user-döntés: a launch-fizetés NEM QVIK, hanem a CIB
  bankkártyás vPOS** (a cég számlavezető bankja; ~1,6% jutalék, kártyás láb →
  a diaszpóra-feladók is fizethetnek). A `paymentProvider.js` mostantól
  `barion | qvik | cib`-et ismer; a `PAYMENT_PROVIDER=cib` + `CIB_API_KEY` +
  `CIB_MERCHANT_ID` + `CIB_BASE_URL` env-ekkel vált élesre, a `cib.js`
  skeleton (vPOS init + státusz-visszaolvasás) kitöltése után + egy
  `/payments/cib/callback` bekötésével. ⚠️ Az alábbi QVIK-specifikus
  szöveg (magyar bankappos korlát, QVIK-kedvezményes kettős árazás)
  a CIB-nél OKAFOGYOTT — a kártyás láb nem-magyar feladót is kiszolgál, és
  1,6%-nál az egységes 500/1000 valószínűleg felesleges kettős árazás nélkül
  is megy (lásd 🟡 CIB-véglegesítés). Az itt lentebb maradt QVIK-szöveg
  történeti. ⚠️ Következmény:
  a QVIK HUF-os, magyar bankappos fizetés → a kapcsolatfelvételi díjat csak
  magyar bankszámlás feladó tudja fizetni (a folyosó-fuvarok diaszpóra-
  feladóinak többségénél ez OK; nem-magyar feladóhoz később kártyás
  alternatíva kell majd, pl. Stripe — 2027+ kérdés). ⚠️ JOGI SZABÁLY a
  kártyás lábhoz (2026-07-11): **kártya-FELÁR tilos** (PSD2 — fogyasztói
  kártyára az EU-ban surcharge nem számolható fel, "kényelmi díj" néven
  sem); a legális irány a FORDÍTOTT keret: magasabb listaár + **QVIK-
  kedvezmény** (pl. kártyával 650/1.690/2.690/4.290, QVIK-kel a kommunikált
  500/1.490/2.490/3.990) — a QVIK a default/kiemelt opció a fizetőoldalon.
  EUR-sávoknál egyszerűbb: a kártyaköltség eleve beárazva.
- **FIZETÉS-ELFOGADÁS ÁLLÁS (2026-07-19, user-info): a CIB-bel (a cég
  számlavezető bankja) az egyeztetés MEGTÖRTÉNT, véglegesítés a család
  nyaralása UTÁN.** A CIB ajánlata: **bankkártyás elfogadás 1,6%
  jutalékkal** (jó ár; 500/1000 Ft-os díjnál mindössze 8-16 Ft/tranzakció).
  Következmények, ha megköttetik: (1) a kártyás láb megnyitja a nem-magyar
  (diaszpóra-) feladókat — a „csak magyar bankappos QVIK" korlát oldódik,
  a 2027-es Stripe-kérdés valószínűleg okafogyott; (2) 1,6%-nál a fenti
  kettős árazás (kártya-listaár + QVIK-kedvezmény) valószínűleg felesleges
  bonyolítás — egyszerűbb az egységes 500/1000 és a 8-16 Ft-ot elnyelni
  (döntés véglegesítéskor); (3) a `paymentProvider.js` absztrakció kész —
  CIB vPOS providert kell írni (PAYMENT_PROVIDER=cib), amint API-doksi van.
  **Kérdés-checklist a CIB-véglegesítéshez**: QVIK fizetési kérelem
  elfogadás kereskedőként + annak díja; vPOS API + AZONNALI webhook/callback
  a fizetés-visszaigazolásra (a kontakt-felfedéshez gépi, másodperces
  visszajelzés KELL); van-e fix havi díj / tranzakciónkénti fix díj /
  minimum forgalom a 1,6% mellett; kiutalási ütem (bank-direkt = azonnal a
  CIB-számlára?); nemzetközi kártyák + Apple Pay / Google Pay; teszt-
  környezet és dokumentáció elérhetősége
- **D-U-N-S szám** — Apple-enrollment-flow indítása apukán át (Apple Developer fiók)
- **Gmail "Küldés másként" megerősítése** — a user állítja be, hogy a
  gmailből info@gofuvar.hu néven válaszolhasson (SMTP: smtp.resend.com,
  port 465, user: resend, jelszó: a Resend API-kulcs + "válasz ugyanarról
  a címről" pipa). A bejövő irány már ÉLES (lásd ✅ lista)
- ~~SeeMe.hu — API kulcs Railway env-be~~ → ✅ ÉLES (2026-07-13, lásd a ✅ listát)
- ~~Számlázz.hu / Billingo~~ → **a kód KÉSZ (PR #95, ✅ lista)** — már csak:
  Számlázz.hu regisztráció (2026-07-19-én folyamatban) + Agent-kulcs + NAV
  technikai user a fiókba + env-ek (aktiválási checklist a ✅ bejegyzésben)
- **Tesztelői visszakérdezések** (a 2. körből elhalasztva): BUG-005 — hol
  látott fejléc-avatart (a fejlécben monogram van); BUG-033 — melyik 4
  különböző feliratú menüpont visz ugyanoda. Termék-/design-döntést vár:
  BUG-019 forgatás-kerülés (OCR-alapú duplikátum-szűrés korlátja),
  BUG-034 teljes mód-alapú navigáció (IA-redesign)

### 🟠 Phase 6 (későbbre)
- Privát R2 file storage + audit log (progressive_kyc-vel kompatibilisre — már van branch, csak nem mergelve)
- Mobile native app (App Store + Play Store)
- Top 5 útvonal-landing oldalak — ✅ ALAP KÉSZ (PR #62, `/fuvar/<utvonal>`);
  bővíthető több útvonallal az adatból (lib/landings.ts)
- Sofőröknek külön landing — ✅ KÉSZ (`/soforoknek`, PR #62)
- Service Worker offline-támogatás (a sofőr elfogadott fuvarjait offline lássa)
- Custom domain név pointing API-ra (api.gofuvar.hu = Railway)
- Cégkivonat-igénylés Apple-D-U-N-S-hez
- Magyar ügyvéd-review az AI-által írt EU-kiegészítésekre
- **Team / multi-user céges regisztráció** (user erősen fontolgatja,
  2026-07-05) — egy céges fiók alá több sofőr/felhasználó (pl. költöztető
  cég 5 kocsival, bútorbolt több ügyintézővel). Al-fiók/jogosultság-kezelés,
  nagyobb feature — a launchhoz 1 login/cég elég. Ha ide kerül: nézd meg a
  céges strategy-döntést (5. szakasz) és a company_verification dormant
  plumbingot (PR #57)

---

## 7. Hogyan dolgozzunk (working style)

### Workflow
1. User mond egy feladatot Magyarul
2. **Plan-ot prezentálok** ha nagy (>30 perc munka), ha kicsi → indulok
3. **Új feature-branch** main-ről (pl. `claude/<rövid-leírás>`)
4. Implementálás, lokális `next build` ellenőrzés
5. Commit (HU-szöveg, részletes), push
6. **PR a `gh` CLI-vel** (2026-07-02 óta telepítve, `propertyTitan` fiókkal
   bejelentkezve, `repo`+`workflow` scope-pal — workflow-fájlt is tud pusholni).
   Fallback ha a gh valamiért nem megy: **közvetlen `git merge --no-ff`
   main-re + push** — a Vercel/Railway így is auto-deployol.
7. Migráció ha kell: `cd backend && npm run db:migrate` (a prod Neon ellen)
8. Vercel + Railway automatikusan deployol; **~1800 teszt fut CI-ben minden
   PR-en és main-pushon**. ⚠️ **2026-08-12-ig a backend teszt-lépése NEM
   KAPUZOTT** (piros suite mellett is átment, mert a `pg.stop()` felülírta a
   kilépési kódot) — javítva, `ci-kapu-or.test.js` őrzi. Lefedettség: sorok
   93,63% / utasítások 92,28% / függvények 88,01% / elágazások 86,50%, padló
   90/89/84/83 (`scripts/lefedettseg-or.js`). Az alábbi bontás a 2026-08-07-i
   állapot, csak a fő osztályok bemutatására:
   - **87 web unit** (Vitest, `web-tests.yml`) — benne a
     **link-integritás osztály-teszt**: minden statikus belső href-hez
     léteznie kell App Router oldalnak (a /adatvedelem-404 osztálya ellen)
   - **1616 backend üzleti szabály** (Vitest + supertest + embedded-postgres,
     `backend-tests.yml`): díj-fizetési guard + consent a /pay-en, kód
     brute-force lockout, lemondás pénzmozgás nélkül, sofőr-lemondás →
     díjmentes reopen, licit-visszaállítás sofőr-cserénél, adat-scrub/IDOR,
     licit-láthatóság, admin-eszkaláció tiltás, kapcsolatfelvételi díjsávok
     (ÁSZF 4.1), foglalás-lezárás (BUG-041), mező-validációk (BUG-011),
     plusz két OSZTÁLY-teszt:
     - **gonosz-input suite**: a fő írási végpontok rossz inputra (szóköz,
       óriás string, rossz típus, negatív/óriás szám) SOHA nem adhatnak
       500-at
     - **scrub-ALLOWLIST**: kívülálló pontosan a felsorolt publikus
       job-mezőket kaphatja — új DB-oszlop = a teszt elhasal, tudatos
       döntés kell (a paid_at-szivárgás osztálya ellen)
   - **208 böngészős E2E** (Playwright, `e2e-tests.yml` — teljes stack:
     beágyazott PG:54332 ← backend:4100 ← Next:3100, valódi Google Places,
     Maps-kulcs repo-secretből): regisztráció; fuvarfeladás Places-címmel;
     teljes pénz-út két böngészőben (licit → elfogadás → „Fizetésre vár"
     guard → díj-fizetés consent-checkboxszal → kontakt-felfedés → pickup →
     kód-lezárás); vita; ellenajánlat-alku; Hozasd el (mockolt link-preview +
     termékkép a sofőrnél); admin KYC jóváhagyás; feladói lemondás (díj nem
     jár vissza) + sofőr-csere (díjmentes újraválasztás); **stale-state
     osztály** (user-váltás reload nélkül: banner/harang-badge — BUG-015/030
     osztálya); **foglalás-végrehajtás UI** (sofőr pickup+kód → feladó
     Kézbesítve — BUG-041 osztálya)
   Lokálisan: `cd web && npm test` / `npm run test:e2e` ill.
   `cd backend && npm test` (a teszt-Postgresek az 54331/54332-es porton
   futnak — a prod Neont teszt SOHA nem éri el).
   E2E-tanulságok: Google Places legördülőt billentyűvel választani
   (ArrowDown+Enter, kattintás instabil); teszt-user token lokális HS256
   aláírással (login/register rate-limit miatt); külső kép-URL-eket
   page.route-tal mockolni (404-re az onError elrejti az img-et).
9. User böngészőből ellenőrzi (élesben verifikálás gyakran: DB-teszt a
   `backend/.env` connstringgel + headless screenshot request-interceptionnel,
   Vercel bot-védelem miatt lokális prod-build a `https://api.gofuvar.hu`-ra)

### Kommunikációs stílus
- Magyar nyelven, közvetlen, **őszintén** (nem corporate-speak)
- Bullet-listák, táblázatok jól mennek; user-nek könnyen olvasható
- **Ne ígérgessünk irreálisat** — ha nem tudom, mondjam meg
- A user üzleti döntéseit **NE** írjuk felül egyoldalúan (lásd #5 lista)
- "🌙 Aludj" / emojik = OK, barátságos hangnem
- Pénzt nem említek soha "ingyen" jelleggel ha tényleg fizetős (Resend free, Sentry free, OK megnevezni)

### Mit nem csinálok
- NEM hozok létre `.md` doksit, csak ha user explicit kéri
- NEM amend-elek korábbi commitot
- NEM force-push-olok
- NEM mergelek PR-t ha kétséges (csak ha user explicit OK-zott)
- Production-deploy: PR + user-tudtával

### Design-szabályok (2026-07-12)
- **Betűméret-skála**: ÚJ kódban fontSize CSAK 11/12/13/14/16/18/20/24/32 px
  (tokenek a globals.css-ben: `--fs-caption`…`--fs-h1`) vagy clamp() a
  hero-címekhez. Köztes érték (12.5, 14.5, 15.5…) TILOS. Régi kód sweepelése
  fokozatos — amihez épp hozzányúlunk.
- **UI-ikon**: mindig lucide, emoji TILOS (emoji csak prózában/bannerben — PR #75/#76).
- **Állapotok**: lista-betöltés = `<ListSkeleton rows={n} />`, üres lista =
  `<EmptyState icon={<Lucide/>} title desc cta />`, hiba = `<ErrorState />`
  (mind `components/StateView.tsx`). Kézi `<p>Betöltés…</p>` TILOS. A `Loading`
  (kamionos spinner) részlet-oldalakra való, listákra nem.
- ⚠️ **rgba-tint csapda**: inline style-ban a `var(--primary-subtle)` /
  `--success-light` stb. HÁTTÉRHEZ a globals.css egy `!important`
  szöveg-színszabályt társít ([style*=…] szelektorok, dark-mode mentőháló) —
  ha a belső színt magad adod, rgba-tintet használj háttérnek
  (pl. `rgba(37,99,235,0.10)`; minta: ProductPreview, StateView).
- **OG-kép**: `web/scripts/generate-og-image.js` → `public/og-image.png`
  (szöveg-változásnál újragenerálni, ne kézzel szerkeszteni).

---

## 8. Branch / commit-history navigáció

A munkák majdnem mind PR-eken keresztül mentek. A legfőbb merge-PR-ek:

| PR | Mit |
|---|---|
| #2 | check-gofuvar-status → main (49 commit, másik Claude-session munkája) |
| #3 | Privacy/UX features (email verify + password reset + Sentry + dispute + cookie) |
| #4 | ÁSZF v2 + Adatkezelési v2 (10-pontos hiánylista) |
| #5 | Európa-szintű coverage |
| #6 | ÁSZF + GDPR EU-kiegészítés (5 új mondat) |
| #7 | PWA conversion + noindex robots.txt |
| #8 | AI chatbot knowledge refresh |
| #9 | AI chatbot kemény tiltás app-hallucinációra |

**Új session-ben** ha kell áttekintés:
```bash
git log --oneline -20
```

---

## 9. Tipikus hibakezelés / amit látnod kell

- **⚠️ „Application failed to respond" (502) az API-n = a backend EL SEM
  INDULT.** Nem terhelés, nem DB: boot-idejű hiba. Leggyakoribb ok egy
  `require`, ami nem oldható fel ÉLESBEN. **A Railway CSAK a `backend/`
  könyvtárat deployolja, a repó gyökerét NEM** — tehát a `backend/`-en kívülre
  mutató relatív hivatkozás (pl. `require('../../../shared/valami.json')`)
  lokálisan és a CI-ban működik, élesben viszont leállítja az EGÉSZ szervert.
  Megtörtént 2026-08-14-én (PR #179 után), és sem a lokális futás, sem az 5
  zöld CI-check nem fogta meg — ott a teljes repó ki van csekkolva.
  ⚠️ A `shared/` mappa CSAK TESZTEKBŐL hivatkozható (PII-korpusz,
  oldal-leltár); éles kódból SOHA. Ha a backendnek adatfájl kell, tedd a
  `backend/src/data/` alá. Őrzi: `tests/deploy-gyoker-or.test.js` (minden
  relatív require-t feloldva ellenőriz — kilép-e a `backend/`-ből, illetve
  létezik-e egyáltalán a cél).


- **Railway = Node 24 (2026-09-10 óta, `backend/.node-version`)** — a CI
  Node 22 + npm 11-gyel fut, a lokális fejlesztés Node 24; a suite mindkettőn
  zöld. Node-verziót a Railway-en CSAK ezzel a fájllal váltsunk (Railpack
  prioritás: RAILPACK_NODE_VERSION env > devEngines > engines.node > .nvmrc
  > .node-version)
- **Build fail Vercelen** → SWC parse error, általában láthatatlan karakter
  egy file-ban. Megoldás: a file-t Write-tal újraírni tisztán.
- **Railway nem deployol** → ellenőrizni Settings → Source → Branch (= `main`?)
  + Auto deploys = enabled
- **Vercel "Preview only"** → Settings → Git → Production Branch = `main`
- **DB-eredetű "Szerverhiba" (500)** → a prod DB a **Neon** (nem Supabase!).
  Nézd a Neon compute-kvótát/csomagot a console.neon.tech-en. Teszt: a
  `/tracking/:token` végpont 500-at ad ha a DB döglött, 404-et ha él.
- **PG SSL warning a Railway logokban** → nem hiba, csak figyelmeztetés
- **SMS nem megy ki** → Railway log, keresés: `sms`. code=13/7-nél a Sentry
  MELLETT e-mail riasztás is megy az info@gofuvar.hu-ra, és az SMS NEM vész
  el: a `sms_retry_queue` 48 órán át 10 percenként újrapróbálja — a hiba
  elhárítása után magától kimegy. `code=13` = IP nincs engedélyezve;
  2026-08-30 óta a SeeMe IP-szűrőjében a TELJES tartomány
  (0.0.0.0–255.255.255.255) engedélyezett, tehát code=13 csak akkor jöhet,
  ha a tartomány-szabály ELTŰNT → SeeMe admin → SMS Gateway → IP-szűrés →
  a tartomány újrafelvétele. code=7 = SeeMe egyenleg elfogyott (feltöltés).
  Gyors kézi teszt: `SEEME_API_KEY=... node scripts/sms-teszt.js +36...`;
  teljes lánc: `node scripts/sms-e2e-fustteszt.js +36...`
- **„Nem jött SMS" a teszt-fuvarnál** → ELŐSZÖR nézd meg, van-e a fuvaron
  `recipient_phone`. Az 1 db SMS-modellben az SMS KIZÁRÓLAG a CÍMZETTNEK megy
  a felvételi fotónál — ha a feladó nem pipálta be a „Nem én veszem át a
  csomagot"-ot (recipient_* NULL), SMS SZÁNDÉKOSAN nem megy, a kód az appban
  látszik („🔐 Átvételi kódod" kártya). 2026-09-10-én pont ez volt: a
  teszt-fuvar címzett nélkül ment végig (`closed_by_code_type =
  sender_emergency`), az `sms_retry_queue` üres, a logban `[sms]` sor sincs
  — nem hiba. SMS-teszthez címzett-telefonszám kell a feladáskor
- **Sentry-riasztás „BadRequestError: request aborted"** → NEM szerverhiba:
  egy kliens (jellemzően bot-scanner vagy elejtett mobil-kapcsolat)
  Content-Length-et ígért, de a test nélkül bontott. 2026-09-10 óta a
  központi hibakezelő a body-parser/raw-body MINDEN 4xx-es, `type`-os hibáját
  kliens-hibaként kezeli (400 `REQUEST_ABORTED`/`MALFORMED_BODY`, napló és
  Sentry nélkül; őr: app-kapuk-es-hibakezelo.test.js nyers sockettel). Ha
  mégis jön ilyen riasztás, a szabály sérült
- **404/403-hullám a Railway HTTP-logban** (több száz kérés EGY IP-ről 1 perc
  alatt: `.env*`, `.git/config`, `wp-json`, `/wp/`…) → automata
  titok-/WordPress-scanner, nem célzott támadás; mind 404 (nincs mit
  találni — a Manus-audit igazolta), a POST-jaikat a Railway WAF 403-mal
  blokkolja (`responseDetails: Blocked by Railway WAF`). Semmi teendő, amíg
  csak 4xx. Lekérdezés: `railway logs --http --json --since <ISO> --filter
  '@httpStatus:404'` (a CLI 500 sort ad vissza, szűrni kell)
- **`npm install` elhal a CI-ben / Railway-buildben: „Cannot read properties
  of null (reading 'edgesOut')"** → az npm 10 (a Node 22/20 beépített npm-je)
  peer-feloldási hibája, amit a registry-ben MEGJELENT ÚJ csomag vált ki, nem
  a kód (2026-09-10: a `vitest` transzitív peer-halmaza; a 08-31-i zöld CI
  után új commit nélkül lett piros). ⚠️ Mivel a package-lock.json NINCS
  verziókövetve, MINDEN friss install (CI, Railway, Vercel) újra feloldja a
  fát, tehát a registry-változás önmagában eltörheti a buildet — a Railway
  is Node 22 + npm 10-zel épít (`NODE_ENV=production` NEM véd: az npm a
  dev-fát is feloldja, csak nem telepíti). Javítás (2026-09-10): npm 11 a 3
  workflow-ban (`npm install -g npm@11` lépés) és a Railway-en **Node 24**
  (`backend/.node-version` = `24` → bundled npm 11). ⚠️ A `packageManager:
  npm@11.11.0` mező NEM MŰKÖDÖTT a Railpackkel (PR #212, build 0a011f93):
  a Corepack „előkészítette" az npm 11-et, de az `npm install` a mise-féle
  Node 22 bundled npm 10.9.8-ával futott és elhalt — az éles API-t nem
  érintette (bukott build = a régi deployment marad). LEMÉRVE: egy commitolt lockfile mellett az npm 10
  `npm install`-ja és `npm ci`-ja is hibátlan — a lockfile verziókövetése
  a robusztus, végleges védelem (user-döntés, mert a projekt eddig tudatosan
  nem követte). Diagnózis-recept: `cp backend/package.json /tmp/x/ && cd
  /tmp/x && npx -y npm@10 install --package-lock-only` reprodukál lokálisan
- **Robotok / noindex** → src `web/public/robots.txt` jelenleg `Disallow: /` — élesedéskor `Allow: /`-ra

---

## 10. Új session quick-start (ha ide ránézel és nem tudod mit csinálj)

1. **Üdvözöld a user-t magyarul**, röviden
2. **Kérdezd meg**: van-e konkrét feladat, vagy státusz-update kell
3. Ha **QVIK-helyzet**: kérdezd meg, megjött-e a fizetés-elfogadási
   jogosultság (a Barion 2026-07-11 óta VÉGLEG elvetve — ne hozd fel)
3/b. Ha **launch-előkészítés** zajlik (QVIK megjött / launch-dátum szóba
   kerül): **🚨 ELŐSZÖR az `ALLOW_STUB_PAYMENTS` env TÖRLÉSE a Railway-en 🚨**
   (6. szakasz legeleje — enélkül a kapcsolatfelvételi díj TELJESEN
   megkerülhető), majd **KÖTELEZŐEN hozd fel a 6. szakasz 🔴 Launch-kapu adatvédelmi/
   jogi ellenőrzőlistáját** és menj végig rajta a userrel (ő kérte,
   2026-07-18) — plusz: robots.txt `Allow: /`-ra, számlázás-aktiválás
   (a kód KÉSZ, PR #95 — `SZAMLAZZ_AGENT_KEY` + `INVOICE_PROVIDER=szamlazz_hu`
   env kell), valódi pénzes QVIK-füstteszt, SeeMe-egyenleg, Gmail „Küldés
   másként", szállító-toborzás ELŐBB mint feladói marketing
4. Ha **Apple-helyzet**: D-U-N-S megérkezett-e, enrollment hol tart
5. Ha **bug**: kérdezz konkrét reprodukálási lépést / screenshot / Sentry-link
6. Ha **új feature**: győződj meg róla hogy nem ütközik a #5 üzleti döntésekkel
7. **Mindig pulld a main-t** mielőtt fejlesztesz

---

## 11. Fontos még tudni

- A magyar piac konkurensei: **iFuvar, Pickk, OLX-fuvarozási kategória, Facebook-csoportok**
- A te platformod **érettebb** mint a fenti versenytársak (KYC AI, recipient SMS, dispute UI, audit log)
- A reális első éves bevétel: **0-30M HUF** (Bear-Base case)
- 18 hónap után **2-3M HUF/hó** ~65% eséllyel
- A **QVIK-jogosultság (fizetés-elfogadás)** a fő külső függőség — ha megvan,
  a `qvik.js` kitöltése + env-váltás után lehet launch (a Barion 2026-07-11
  óta VÉGLEG elvetve, a Barion-kód csak dormant maradvány)

---

## 12. Apa & család kontextus

- Apa (Jovány Gyula) tulajdonos + ügyvezető — **csak külső dokumentumokra kell**
  (Apple Developer signing, PSP/QVIK-szerződés, banki ügyek)
- A user családi céget használ — **stabilitás háttérben**, ezért kibír 18 hónap
  veszteséget
- A user érzelmi háttér: néha túlteher, néha pumped — légy emberi társa

---

> **Frissítési szabály**: ha valami megváltozik (új release, új partner-API
> kulcs élesedett, üzleti döntés módosul), frissítsd a megfelelő szakaszt
> ÉS írj egy commitot:
> ```
> docs(CLAUDE.md): <mi változott>
> ```
>
> **Méret-szabály (2026-09-17):** a Claude Code 150 KB fölött figyelmeztet
> a CLAUDE.md-re. Új ✅ tétel a ✅ összefoglaló TETEJÉRE megy, röviden; ha a
> fájl 120 KB fölé nő, a legrégebbi lezárt köröket VÁLTOZATLAN szöveggel a
> `CLAUDE2.md` megfelelő részének végére kell átmozgatni (időrend: legújabb
> felül), és itt csak a máig érvényes szabály marad belőlük. Új melléklet
> (`CLAUDE3.md`) csak akkor, ha a CLAUDE2.md is 150 KB fölé nő.
