# CLAUDE.md — GoFuvar projekt context

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
- Licites fuvar + fix áras útvonal-foglalás + visszafuvar matching + instant ("UberFuvar")
- KYC AI-val (Gemini olvas ID-t, kor-ellenőrzés, admin jóváhagyás)
- **Készpénzes modell (2026-07-03)**: a fuvardíj KÁPÉBAN megy a sofőrnek
  (100%, levonás nélkül); a platform sávos KAPCSOLATFELVÉTELI DÍJAT szed a
  feladótól elfogadáskor (QVIK, sima díjfizetés — NEM kell escrow!);
  kontakt-felfedés csak a díj után; az escrow-kód dormant (később
  "Védett fizetés" opció lehet)
- 6 jegyű átvételi kód + QR kód
- **1 db SMS-modell (2026-07-13, user-döntés)**: a címzett EGYETLEN SMS-t kap,
  a csomag FELVÉTELEKOR (átvételi kód + sofőr neve/telefonszáma + "egyeztess
  vele az érkezésről"); **ÉKEZETESEN megy (user-döntés, minőség)** → UCS-2,
  max 2 szegmens (~40-60 Ft/fuvar; név 22 karakterre vágva, worst case 131
  kar — a sendSms már NEM ékezettelenít, a removeAccents export megmaradt
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
- Migrációk lokálisan futnak a prod ellen: `npm run db:migrate`
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
| Üzleti modell | **KÖZVETLEN FIZETÉS a felek közt (2026-07-03 pivot, felelősséget vállalta)**: a fuvardíj 100%-a a sofőré, a platform NEM kezeli; bevétel = kapcsolatfelvételi díj. A korábbi 10%+400 escrow-modell hatályon kívül (kód dormant, később "Védett fizetés" opció). ⚠️ **2026-07-15 pontosítás**: a fizetés NEM korlátozott készpénzre — a felek megállapodhatnak **átutalásban is** (pl. cég-cég közt); az ÁSZF 4.2 + chatbot ezt megengedi. A "készpénz" csak a C2C-marketing egyszerű ALAPÜZENETE (landing marad kápé-fókuszú a fő perszónákhoz), a lényeg: a díj sosem folyik át a platformon |
| Kapcsolatfelvételi díj | **EGYSZERŰSÍTETT LAUNCH-ÁRAZÁS (2026-07-15, user + ügyvezető döntése — elsődleges cél a USER-GYŰJTÉS)**: ≤50 000 Ft fuvardíjig → **500 Ft** / felette → **1.000 Ft**, bruttó, BEVEZETŐ ár (mindenhol így kommunikálva!). A korábbi 4 sávos (500/1490/2490/3990) struktúra hatályon kívül. NEM visszatérítendő (45/2014. 29.§(1)a consent-checkbox a fizetésnél); a fuvarra szól: sofőr-meghiúsulásnál díjmentes újraválasztás, másik fuvarra NEM vihető át. **2026-ban a bevezető sávos ár marad; díjemelés legkorábban 2027-től** (user döntése, 2026-07-06; korábbi emelési jelzés: stabil ~300+ fuvar/hó). **2026-07-11 fontolgatás (NEM döntés): feladói B2B-előfizetés** — 3.990 Ft/hó, mellette minden feladás fix 400 Ft kapcsolatfelvételi díj (sávtól függetlenül); break-even a feladónak: ~2-4 közepes/nagy fuvar/hó → önszelektáló, a visszatérő céges feladót fogja meg. ⚠️ A 2026-07-15-i egyszerűsített árazással (500/1000) ez a matek ELAVULT — ha a B2B-csomag napirendre kerül, újraszámolandó. Feltételek ha egyszer élesedik: fair-use plafon (viszonteladó-arbitrázs ellen), céges/KYB-fiókhoz kötés javasolt, recurring fizetés kell; legkorábban 2027, a team/multi-user + sofőr-előfizetéssel egy polcon ("GoFuvar Business") |
| Sofőr díjmentessége | **2026-ban a sofőr BIZTOSAN díjmentes** (user döntése, 2026-07-06): a fuvardíj 100% kápé, a platform a sofőrtől semmit nem szed. A megfontolt **sofőr-előfizetés** (990 Ft/hó, ELSŐ HÓNAP INGYEN, token-alapú auto-megújítás) NEM 2026-os — legkorábban **2027**, és CSAK ha (a) a Barion recurring/token fizetés él, (b) van sűrű fuvarforgalom (a sofőr egy nap alatt visszakeresi). **2026-07-11 user-pontosítás:** ársáv **1.000–2.000 Ft/hó**, trigger: **~500–1000 AKTÍV sofőr** (javasolt mérce: aktív = havi ≥1 teljesített fuvar — a fuvarsűrűség a valódi feltétel, nem a regisztrált darabszám); még csak fontolgatás, nem döntés. Jogi: auto-megújítás fogyasztóvédelmi tájékoztatás + könnyű lemondás + terhelés előtti emlékeztető. Kártyát nem a regisztrációnál, hanem az ingyen hónap vége felé / első fuvarnál javasolt kérni (kínálat-megtartás) |
| Kontakt-kapuzás | Telefonszám/email CSAK a díj megfizetése után látszik (ez a kikerülés-védelem lényege; chat contactGuard fizetés előtt szűr) |
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

### ✅ Kész (élesedett)
- **HÁROM FÜGGETLEN ADATVÉDELMI LENCSE + a teljes javítási kör (2026-08-09/10,
  PR #143-148)** — a user kérésére 3 ügynök futott EGYSZERRE, de MÁS
  szemszögből: séma/tárolás (**7/10**), adatáramlás (**7/10**), érintett+jogi
  (**6/10**). ⚠️ **A KÖR FŐ TANULSÁGA: a ~15 súlyos találatból mindössze
  NÉGYET talált meg egynél több lencse.** Vagyis a korábbi körök „ezt
  lezártuk" következtetése strukturálisan megbízhatatlan volt — nem azért nem
  találtak többet, mert nem volt több, hanem mert EGY szemszögből néztek.
  Összkép: **a gépezet erős, a papír hazudott** (a 11 megőrzési ígéretből 11
  stimmelt a kóddal, de négy helyen olyat vállaltunk ÍRÁSBAN, ami a kódban
  nem volt igaz). Javítva:
  **(1) SENTRY-SZIVÁRGÁS (PR #143)** — a SeeMe SMS-gateway GET-es, tehát az
  ÉLES API-kulcs + a címzett telefonszáma + a teljes SMS-szöveg (6 jegyű
  ÁTVÉTELI KÓD + szállító neve/telefonja) a query stringbe kerül; a Sentry SDK
  a nyers query stringet külön mezőbe (`http.query`) írja; a mi scrubunk
  viszont MEZŐNEVEKET sorolt fel (url/to/from). A kiváltó ok épp a saját
  SMS-hiba riasztásunk (code=13 = VÁRT hibamód). Ugyanez vitte a Nominatim
  `?q=<cím>`-et és a VIES adószámot. Fix: strukturális (minden URL-jellegű
  kulcs + a query string EGÉSZBEN eldobva). ⚠️ A régi teszt ZÖLD volt — kézzel
  írt fixtúrán, ami nem egyezett a valódi SDK-alakkal; az új suite ŐRE az SDK
  FORRÁSÁBÓL olvassa ki a mezőneveket. **A Sentry session replay NEM fut**
  (a `replayIntegration` egyik alapértelmezett integrációs listában sincs) —
  a félrevezető konfig kivéve. **(2) NÉGY ÁRVA-FÁJL ÚT (PR #144)** — a
  KYC-ÚJRAFELTÖLTÉS (új random kulcs + ON CONFLICT → az előző SZEMÉLYI
  IGAZOLVÁNY fotója örökre a bucketben; és ez a NORMÁL út, mert a pending-nél
  újrafeltöltésre kérjük a usert), az avatar-csere, a MÁSIK FÉL fotói (a
  gyűjtő csak `uploader_id`-re nézett), és a `disputes.evidence_url`.
  **(3) CÍM-ELREJTÉS (PR #145)** — a `split(',')[0]` CSAK magyar formátumon
  működik: „Hauptstraße 5, 10115 Berlin" → „Hauptstraße 5". ÉLŐ szivárgás
  volt Európa-szintű coverage mellett, és kiütötte a mellette lévő ~1 km-es
  koordináta-kerekítést. Új `utils/address.js`, TARTALOM-alapú. Plusz: az
  ELHAGYOTT (soha le nem zárt) fuvarnak nem volt életciklusa → 1 év után
  auto-lezárás. **(4) HTML-INJEKTÁLÁS + SOCKET (PR #147)** — hat inline
  sendEmail nem escape-elt: egy szállító a saját NEVÉBE tett linkkel
  GoFuvar-arculatú, noreply@gofuvar.hu-ról érkező levelet küldethetett; és a
  `job:join` csak BELÉPÉSKOR ellenőrzött, kilakoltatás nem volt → a leváltott
  szállító tovább kapta az ÚJ szállító GPS-pingjeit. **(5) KYC-LENYOMAT +
  JOGI SZÖVEGEK (PR #148, 063-as migráció, prodon lefutott)** —
  **USER-DÖNTÉS: a fiók törlésével ne lehessen „kvázi újként" visszaregisztrálni.**
  A tájékoztató + 30. cikk + érdekmérlegelési teszt II. mind 5 éves
  hash-megőrzést állított, a CASCADE viszont azonnal törölte → új
  `kyc_doc_history` tábla (user-független, csak SHA-256 + időbélyeg, 5 év
  retencióval). ⚠️ NEM kemény tiltás: a visszatérő EMBERI ellenőrzésre kerül
  (`PREVIOUSLY_DELETED_ACCOUNT`) — a cél nem a kizárás, hanem hogy ne lehessen
  ELŐZMÉNY NÉLKÜL visszajönni. **USER-DÖNTÉS a KYC-jóváhagyásról: a KÓD marad
  (tiszta eset automatikus, kockázati jel → admin), a SZÖVEG igazodik.**
  Továbbá: a Trust Score-nál PROFILALKOTÁST vallottunk magunkra, amit nem
  végzünk (nincs ORDER BY trust_score, nincs auto-felfüggesztés); a **DAC7
  adóazonosító jel** gyűjtéséről NULLA tájékoztatás volt; az adatfeldolgozói
  listán Barion állt, hiányzott a CIB, a Számlázz.hu, a Nominatim és az
  ImprovMX. Mind javítva. **(6) AUDIT-NAPLÓ VERSENY (PR #146)** — a
  `logAdminAccess` fire-and-forget volt: egy PII-hozzáférési naplónál a
  „talán kiírjuk" nem elég (deploy/összeomlás esetén a hozzáférés megtörtént,
  a nyoma nem). Mostantól await. Backend **680/680**.
  ⚠️ **SAJÁT HIBÁIM, tanulságnak**: (a) MÁSODSZOR írtam **backticket SQL-
  kommentbe JS template literal belsejében** → a teljes backend nem indult
  volna (mindkétszer a teszt fogta meg); (b) a PR #141-gyel **flaky teszteket
  engedtem a main-re** (a CI ott zöld volt — egy futás nem bizonyít
  stabilitást; azóta 3 teljes futással igazolok); (c) a #144 kommentjében azt
  írtam, az árva-fájl osztály „le van zárva" — nem volt igaz.
  ⚠️ **NYITOTT**: (i) a MÁR MEGLÉVŐ árva fájlok a bucketekben (R2 ListObjects
  + DB-összevetés kell, hálózati művelet); (ii) halott PII-séma törlése
  (`kyc_documents.doc_number` PLAINTEXT + `full_name_on_doc` + 6 oszlop +
  4 nem hívott függvény) — destruktív, önálló PR; (iii) a nyitott fuvar
  cím-pontossága (termékdöntés); (iv) JSON-export GOMB a profilra (a végpont
  KÉSZ, csak a felületről nem érhető el); (v) a szöveg/jogi kör maradéka
  (DSA report/block, ÁSZF-átfésülés) — a user külön körre halasztotta
- **ADATVÉDELMI KÖR 3 — SÉMA-ALAPÚ audit (2026-08-09, PR #139-141)** — a user
  jogos kifogása után („mennyire jó az adatvédelmünk, aztán minden új teszt
  10/6-ot hoz valami kritikus hibával") a 3. kör NEM a kódot járta végig,
  hanem az ADATOT: tábláról táblára, oszloponként. Ezért találta meg azt,
  amit két kód-alapú kör nem. **Pontszám: 7,5/10** (előtte 7,0 és 6,5).
  ⚠️ **A módszertani tanulság a fontosabb: két kód-alapú kör után is maradt
  négy határidő nélkül őrzött adattípus — mert a kódot olvasva az látszik,
  ami MEG VAN írva, nem az, ami HIÁNYZIK. A sémát olvasva fordítva.**
  Tételesen: **(1) HIRDETÉSI FOTÓ** — a purge csak a pickup/dropoff képekre
  futott, a `listing` viszont a FELADÓ lakásában készül, a PUBLIKUS bucketbe
  megy, egyéves cache-sel, és a kívülállók is látják → ez volt a rendszer
  leghosszabb ideig tartó, legszélesebb körű expozíciója (`PHOTO_KINDS` most
  mind az 5 típus). **(2) ADMIN-TÖRLÉS R2-ÁRVÁK** — a fiók-törlésnél reggel
  lezárt hibaosztály három végpontja kimaradt (`collectEntityFileKeys`).
  **(3) `payment_events.summary`** a feladó TELJES NEVÉT tárolta szövegben,
  míg az azonosító-oszlopok törléskor nullázódnak → most az id. **(4)
  `deleted_accounts`** sózatlan, visszafejthető e-mail-lenyomatot őrzött
  ÖRÖKRE — épp attól, aki a törlési jogát gyakorolta —, és SEMMI nem olvasta
  (HMAC + 5 év; a 061-es migráció a prodon a 8 meglévő lenyomatot törölte,
  a törlés ténye maradt). **(5) ÖT LEFEDETLEN TÁBLA** (PR #140, 062-es
  migráció): a 060-as kör a fuvar SORÁT anonimizálja, de a fuvar KÖRÉ épült
  szabad szöveg másik táblában él — `bids.message` + `job_questions` (mit
  szállítunk, hogyan közelíthető meg a lakás, ki lesz otthon) most a fuvar
  anonimizálásakor ürül; `carrier_routes` 3 év (sablon kivéve — a waypoints
  sok soron át MOZGÁSPROFIL); `disputes` a LEZÁRÁS után 5 év (visszás volt:
  a vita MIATT zároltunk 5 évre fotót/chatet, magára a vitára semmi nem
  vonatkozott); `invoices` 8 év (Számv. tv. 169. § — itt a hosszú megőrzés
  KÖTELEZETTSÉG, nem mulasztás, de utána elévül). **(6) ANONIMIZÁLÁS-
  HIÁNYOK** (PR #141): a `title` (szintén user-írta szabad szöveg), az
  `ai_description_notes` (a leírásból SZÁRMAZIK → ugyanazt a PII-t őrizte,
  amit töröltünk), a `source_image_url` (a megmaradó shipper_id-vel: ki mit
  vásárolt) és a lakás-adatok (emelet/lift). **(7) ADMIN-NAPLÓ**: csak az
  EGY user részletnézete volt naplózva, miközben a `GET /admin/users` egy
  kéréssel 200 ember elérhetőségét adja, a `GET /admin/jobs` pedig `j.*`-gal
  a címzett adatait + átvételi kódot → a NAGYOBB hozzáférés hagyta a
  KEVESEBB nyomot. **(8) ÁTLÁTHATÓSÁG**: a fiókhasználati mérés (belépések
  száma, aktív idő — az admin-panel meg is jeleníti) hiányzott a
  tájékoztatóból (GDPR 13.). Backend **650/650**, +18 teszt, mind igazoltan
  piros a javítás nélkül (szándékos regressziókkal visszamérve).
  ⚠️ **SAJÁT HIBÁK, tanulságnak**: (a) a 061-es migrációnál TIPPELTEM a sémát
  (`created_at` helyett `deleted_at`, a hash-oszlop NOT NULL volt) — pont az
  a hiba, ami ellen a kör szól; azóta minden mezőt lekérdezek ELŐTTE; (b) egy
  SQL-kommentbe **backticket** írtam egy JS template literal belsejében → a
  teljes backend nem indult volna (a suite fogta meg); (c) a `git add -A`
  bevette a `.claude/worktrees/`-t — most gitignore-olt.
  ⚠️ **MEGLÉVŐ TESZT MEGINT A HIBÁT KODIFIKÁLTA**: a foto-retencio azt írta
  elő, hogy a purge NE érintse a `listing` fotót. Ez a MÁSODIK ilyen ma (az
  első a rate-limit XFF volt) — a minta: „így működik" alapon rögzítünk
  viselkedést, ahelyett hogy „így KELL működnie" alapon tennénk.
  ⚠️ **MARADÉK a 9/10-hez**: (i) a **KYC-lenyomat 5 éves megőrzése** —
  USER-DÖNTÉST igényel: vagy megépítjük a tényleges összevetést egy új
  regisztrációval (csalásvédelem), vagy kivesszük az állítást a
  dokumentumokból; (ii) **halott PII-séma törlése** (6 oszlop +
  `kyc_documents.doc_number`/`full_name_on_doc` + 4 nem hívott függvény) —
  destruktív, önálló, óvatos PR; (iii) **nyitott fuvar cím-pontossága**
  (termékdöntés: a böngésző szállító mennyit lásson fizetés előtt);
  (iv) a szöveg/jogi kör (ÁSZF + tájékoztató Barion→CIB, adatfeldolgozói
  lista, DSA report/block) — a user ezt KÜLÖN körre halasztotta
- **A 2. audit-kör MARADÉK-listája LEDOLGOZVA — 9 tétel (2026-08-09,
  user-kérés: „folytassuk a hibák kijavításával")** — a keresztvalidált
  maradék mind javítva, +41 teszt (backend **556/556**). Tételesen:
  **(1) STUB-FIZETÉS ÉLESBEN = BIZTONSÁGOS MÓD** — eddig csak boot-
  figyelmeztetés volt: egy elfelejtett CIB-kulcs némán elindította volna az
  éles szervert nulla-díjas módban, ahol a `/confirm-payment` NYITVA van
  (bárki fizetés nélkül fizetettnek jelölheti a saját fuvarát) és a webhook a
  nyers body-nak hisz. Most `paymentProvider.isUnsafeStub()` esetén a kézi
  nyugtázás (`manualConfirmAllowed()`, mindkét ág: fuvar ÉS foglalás) és a
  PSP-callback (503) ZÁRVA, a boot pedig hangosan figyelmeztet + Sentry.
  ⚠️ **ÉLES TANULSÁG (ugyanaznap): a hard-fail (`process.exit`) NEM jó** —
  kipróbálva: a Railway-en `NODE_ENV=production`, a CIB-kulcs pedig a
  launchig NINCS, így a boot-exit újraindítási ciklusba tette az éles
  backendet, az API ~10 percig 502-t adott (a `railway variables --set
  ALLOW_STUB_PAYMENTS=true` állította helyre, majd a hotfix vette ki a
  kapcsolót). A launch előtt a „prod + stub" a NORMÁL üzem, nem hiba —
  ezért a védelem futásidejű, és SZÁNDÉKOSAN nincs env-kapcsoló a
  feloldására (az elfelejtve maradna bekapcsolva pont a launchkor).
  ⚠️ USER-TEENDŐ: a Railway env-ből az `ALLOW_STUB_PAYMENTS` törölhető —
  a kód már nem olvassa. **(2) PRIVÁT KYC-FÁJL a webgyökérben** — az express.static
  a `uploads/private`-ot is kiszolgálta, ÉS az R2-hiba csendben diskre esett:
  élesben egy R2-kiesés a SZEMÉLYI IGAZOLVÁNY fotóját a publikus fájl-útra
  tehette. Most: a `/uploads/private` mindig 404, élesben nincs csendes
  fallback (a feltöltés inkább hibázik), a dev-fallback olvasása HMAC-aláírt,
  lejáró `/private-files/…` linken megy (a presigned R2-URL megfelelője).
  **(3) PIACTÉR-FEED szoba** — a `jobs:new`/`jobs:new-instant`/`towing:new`/
  `routes:new` `io.emit`-tel MINDEN sockethez ment, a be nem jelentkezett
  vendégekhez is: fiók nélkül, böngészőkonzolból élőben lehetett PONTOS
  címeket és GPS-t learatni (a mentés-kérésnél a bajba jutott helyzetét).
  Új `feed` szoba (`emitToFeed`), amibe csak hitelesített kapcsolat léphet be
  (`feed:join`); a web `subscribeFeed()`-del lép be. A `towing:new` ráadásul
  már csak ~1 km-re kerekített helyet ad (a REST-scrubbal azonos felbontás).
  **(4) FIZETÉSI GATEWAY-LINK szivárgás** — a `route-bookings:confirmed:<id>`
  globálisan ment: az esemény NEVÉBE írt user-id nem szűr senkit, a fizetési
  link mindenkihez kiment. Most `emitToUser` a címzett szobájába.
  **(5) DUPLA SZÁMLA** — a webhook nem tranzakcionális, az `invoices`-on nem
  volt UNIQUE: két párhuzamos PSP-retry KÉT valódi adóügyi számlát állított
  volna ki ugyanarról a díjról (sztornóval javítható). Most claim-sor a külső
  hívás ELŐTT + 057-es migráció (partial UNIQUE, a 'failed' sorok kimaradnak,
  hogy lehessen újrapróbálni) — **a prodon lefutott**. **(6) EMLÉKEZTETŐ-
  SPAM** — a `payment_reminder_count` a küldés UTÁN nőtt: két egyidejű kör
  duplán sürgette a feladót; most atomi claim (feltételes UPDATE) a küldés
  előtt. **(7) ÖNFENNTARTÓ KUPON-LÁNC** — az ajánlói jutalom a `paid_at`-on
  ült, amit a KUPONOS (0 Ft-os) feladás is beállít: minden új fiók a kapott
  kuponnal „fizetve" újabb kupont termelt, nulla bevételből. A feltétel
  mostantól TÉNYLEGES (>0 Ft) díjfizetés, a szolgáltatásban (nem a hívóban).
  **(8) NAV-JELVÉNY substring** — az „Ellenőrzött cég" `includes()`-szel
  egyeztetett: a hivatalos név egy DARABJÁVAL („Hód Kft.") és tetszőlegesen
  TOLDOTT névvel („Tiszta Hód Szállítmányozás") is járt a jelvény. Most
  szóhalmaz-egyezés (sorrend és cégforma-írásmód továbbra sem számít).
  **(9) KYC vak auto-approve** — az AI `valid:true`-ja azonnal 'verified'-et
  adott. Az automatizmus marad, de 4 kockázati jel emberhez terel
  (`services/kycReview.js`): 0.85 alatti bizalom, az okmány nevének eltérése
  a fióktól, másolat/képernyőfotó-gyanú (új AI-mezők: `holder_name`,
  `likely_copy`), és az olvashatatlan okmányszám (enélkül az „egy okmány =
  egy fiók" védelem némán kimaradt). A KycModal mostantól „Ellenőrzés alatt"
  állapotot mutat (eddig a pending is „elutasítva"-ként jelent meg — fölösleges
  újrapróbálkozásra késztetett).
  ⚠️ **MELLÉKTALÁLAT, fontos: a teszt-suite ÉLES kulcsokkal futott.** Az
  `env-setup.js` `delete`-tel törölte a külső kulcsokat, csakhogy az
  `index.js` első sora `require('dotenv').config()`, ami a `.env`-ből
  VISSZATÖLTI, ami épp nem létezik. Lemérve: az R2- és a Gemini-kulcs ÉLT →
  a fájl-feltöltő tesztek valódi objektumokat írtak az ÉLES bucketekbe (a
  privát KYC-bucketbe is!), a KYC-tesztek valódi, fizetős AI-hívásokat
  indíthattak. Javítva (üres string, nem `delete`) + `teszt-kornyezet.test.js`
  őr, ami elhasal, ha bármelyik éles kulcs újra beszivárog.
  ⚠️ **MARADÉK**: **report/block hiánya (T&S/DSA)** — termék-feature, külön
  kör. (Az ajánlói kupon értékének kérdését a user 2026-08-09-én eldöntötte:
  nem pénzérték, hanem egy ingyenes kapcsolatfelvétel — lásd az „Ajánlói
  program ÉLES" bejegyzést.)
- **2. BIZTONSÁGI AUDIT-KÖR (4 új ügynök) — a kontakt-szűrő TELJESSÉ tétele
  (2026-08-09, user-kérés: „merge után új mély audit")** — a friss main-en
  (mind az 5 aznapi PR-rel) újra futott 4 ügynök, MÁS hangolással: regresszió-
  vadászat a mai változásokra, real-time/socket + háttér-jobok, storage/külső
  API/DB-integritás, állapotgép/maradék-PII. ⚠️ A kör ÉRTÉKE bizonyított: **két
  hiányosságot talált az ELSŐ kör saját javításaiban**: (F1) a `firstContactLeak`-ből
  KIMARADT a `full_name` — pedig a NÉV a legláthatóbb mező (ajánlat-lista,
  kérdés-válasz, publikus profil, MIND fizetés előtt): egy „Hívj 0630…" nevű
  szállító egyetlen profil-beállítással, örökre megkerülte volna a díjat;
  (F5) kimaradtak a CÍM-mezők is (a böngésző szállító a GET /jobs-on látja).
  Továbbá (F2) a vita-leírás szűretlen volt (most: CSAK fizetés előtt szűrünk —
  utána a telefonszám legitim bizonyíték, a chat-minta szerint), (F7) a
  nyilvános értékelés-komment szűretlen (most mindig szűrt: tartós „hívj
  platformon kívül" hirdetőfelület lett volna), és a MENTŐS-SCRUB (#126)
  bennhagyta a pontos `address`-t + rendszámot + leírást + requester_id-t —
  ami a ~1 km-es geo-kerekítést teljesen kiütötte. Mind javítva, +7 teszt
  (`kontakt-szuro-teljesseg.test.js`). Backend 515/515. ⚠️ A regresszió-ügynök
  IGAZOLTA: a mai 5 PR egyébként tiszta (nincs törött hívó, körkörös import,
  boot-hiba; a Barion-törlés és a scrub/tracking/R2 javítások szilárdak).
  ✅ A kör MARADÉK-listája (stub-fizetés hard-fail, dupla-számla verseny,
  emitGlobal helyadat-szivárgás, route-bookings gateway-URL, paymentReminders
  számláló, KYC-AI auto-approve, NAV substring, privát-KYC disk-fallback,
  referral 0 Ft-os trigger) **2026-08-09-én LEDOLGOZVA** — lásd a lista
  legelső bejegyzését. Nyitva maradt: **report/block (T&S/DSA)** mint
  termék-feature, és a referral kupon-érték üzleti kérdése.
- **Mentős-kapu — a segélyszolgálat (towing) végpont-biztonsága (2026-08-09,
  adatvédelem 2. csomag, user: „csináld meg, de maradjon kikapcsolva")** — a
  towing-flow a FELÜLETRŐL kikapcsolva, de a végpontok éltek, és a biztonsági
  audit (3 ügynök keresztvalidálta) találta: (1) mentőssé válni BÁRKI tudott
  egy kattintással (KYC nélkül); (2) a `GET /towing/incoming` a bajba jutott
  TELJES telefonját + PONTOS GPS-ét adta MINDEN mentősnek, elvállalás ELŐTT —
  sérülékeny helyzetben lévők (egyedül, éjszaka, elakadva) adata learatható.
  Fix: (1) `POST /towing/register` mostantól `requireDriverKYC` mögött; (2)
  `scrubTowRequestForList` — a listában csak KÖZELÍTŐ hely (~1 km-re kerekítve),
  keresztnév, probléma-típus, távolság; a teljes telefon + pontos GPS csak az
  elvállalás UTÁN (mint a fő platform díj-kapuja). +3 teszt. Backend 508/508.
  ⚠️ A FUNKCIÓ TOVÁBBRA IS KIKAPCSOLVA (a mentes/* UI dormant) — ez csak a
  végpont-biztonság, hogy bekapcsoláskor ne legyen rés. ⚠️ MARADÉK adatvédelem
  (a 9→10 úthoz): socket-broadcast cím anonim hallgatóhoz + a formális jogi
  réteg (ügyvédi review)
- **Adatvédelmi kör 1. csomag — a GDPR-„elfeledtetés" valódivá tétele
  (2026-08-09, user-prioritás: az adatvédelem min. 9/10)** — a biztonsági
  audit adatvédelmi találatai: (1) **FIÓK-TÖRLÉS R2-TAKARÍTÁS** — a törlés
  eddig CSAK a DB-sorokat vitte (CASCADE), az R2-objektumok (köztük a
  SZEMÉLYI IGAZOLVÁNY fotója!) bennragadtak, és a napi purge-jobok a
  törölt sorokból már nem érték el őket → örök árva fájl, a GDPR 17. cikk
  megsértése. Új `utils/userFiles.js:purgeUserFiles` a DB-CASCADE ELŐTT
  törli a KYC-okmányt + avatart + fuvar-fotókat a tárolóból; bekötve a
  self-delete (auth.js) ÉS az admin-törlés (admin.js) ágába. (2) **Publikus
  profil rendszám kivéve** — a `vehicle_plate` (GDPR szerint személyes adat)
  bárki által lekérhető volt kontaktus/ügylet nélkül; a jármű TÍPUSA marad
  (döntéshez hasznos, nem azonosít). (3) **KYC-értesítés PII-minimalizálás**
  — a 18-alatti + kézi-review admin-notif eddig a teljes e-mailt + születési
  dátumot írta a notif-body-ba (a notifications táblában határidő nélkül); a
  jogosult admin a KYC-panelen látja, a notif-ból kivéve. +3 teszt (a KYC-fotó
  törlődik a self + admin ágon). Backend 505/505. ⚠️ MARADÉK adatvédelmi
  tételek (következő csomag a 9+ pontig): mentős-kapu (bajba jutott telefon/
  GPS elfogadás nélkül), socket-broadcast cím anonim hallgatóhoz, + a formális
  jogi réteg (ügyvédi review — a launch-kapu lista)
- **BARION VÉGLEG TÖRÖLVE + a fizetési webhook provider-független (2026-08-09,
  user-döntés: „töröld a picsába")** — a webhook body-trust rés gyökér-oka a
  Barion-callback volt; a teljes eltávolítással a rés MEGSZŰNIK, nem foltozás.
  Törölve: `services/barion.js` (a dormant escrow-fn-ekkel:
  reservePayment/finishReservation/cancelReservation/refundPayment/
  computeCancellationSettlement — sehol nem hívottak), a `/payments/barion/
  callback` route, a `photos.js` elavult barion-importja. A `paymentProvider.js`
  mostantól `{qvik, cib}` (barion nélkül), **default → `cib`** (a launch
  fizetése; kulcs nélkül stub). A webhook-logika PROVIDER-FÜGGETLEN
  `confirmFeePayment(PaymentId, verifiedStatus)` helperbe szervezve
  (payments.js) — a hívó `handleProviderCallback` a `paymentProvider`-rel
  olvassa vissza a HITELES státuszt (nem a body-t), és a `/payments/cib/
  callback` + `/payments/qvik/callback` erre épül → nincs body-trust rés,
  nulla duplikáció. Tesztek: a fizetes-webhook a cib-callbackre + cib-mockra
  átírva (a hamisítás-védelem így a valós launch-konfigot fedi), a
  webhook-barion-guard teszt törölve (tárgytalan), a provider-tesztek
  default→cib + „a törölt barion HANGOS hiba" (fail-loud), a dijak-teszt
  dormant lemondás-blokkja törölve, routeManifest + szerep-lefedettség
  cib/qvik-re. Backend 502/502. ⚠️ MARADT (nem rés, követő-munka): a
  `barion_payment_id`/`barion_gateway_url` DB-OSZLOPNEVEK (a CIB payment-id-ja
  is ezekbe megy — átnevezés külön migráció + 15 fájl), + pár kód-KOMMENT
  említi még a Bariont (kozmetika). ⚠️ USER-TEENDŐ: a Railway prod env-ből a
  BARION_* változók törölhetők (a kód már nem olvassa)
- **Barion-webhook body-trust rés zárva (2026-08-09, audit 2. csomag)** — a
  `/payments/barion/callback` a `barion.isStub()`-ot nézte, ami a launch
  CIB-konfigban (PAYMENT_PROVIDER=cib, barion kulcs nélkül) örökre `true` →
  a body-nak hitt → egy hamisított `{"Status":"Succeeded"}` POST fizetés
  nélkül beállította a paid_at-ot + felfedte a kontaktot (auth nélküli
  díj-megkerülés; authz + pénz ügynök keresztvalidálta). GUARD: a callback
  410-et ad és semmit nem dolgoz fel, ha nem barion az AKTÍV provider. +2
  teszt (a fuvar + foglalás ág; a meglévő fizetes-webhook teszt "hamis zöld"
  volt: kézzel barion.isStub=false-ra állított, sosem fedte a CIB-konfigot).
  Backend 504/504. ⚠️ USER-DÖNTÉS (2026-08-09): a Barion VÉGLEG TÖRLENDŐ
  (nem csak dormant) — a teljes eltávolítás gondos, önálló refaktor
  (services/barion.js törlése, a paymentProvider default → cib, a
  webhook-logika provider-független `confirmFeePayment` helperbe szervezve,
  a barion-callback route törlése, env-ek, tesztek). A guard MOST zárja a
  rést; a törlés a fizetési MAG átírása, nem elkapkodva. ⚠️ USER-PRIORITÁS:
  a Barion-törlés UTÁN az ELSŐDLEGES az ADATVÉDELEM — cél min. 9/10, törekedve
  a 10-re (a maradék audit-találatok: fiók-törlés R2-árvák, mentős-kapu,
  publikus profil rendszám, KYC-notif PII, + a formális jogi réteg)
- **Biztonsági mélyaudit (4 adverzariális ügynök) — 1. csomag: KRITIKUS
  PII/kontakt-szivárgások (2026-08-09, user-kérés)** — a user "golyóálló"
  biztonságot kért; 4 ügynök (PII/adatvédelem, hozzáférés-vezérlés,
  injection, pénz-integritás) auditálta a rendszert. JÓ HÍR: az input-védelem
  golyóálló (SQLi/SSRF/path/XSS/mass-assignment mind ellenállt), az IDOR/
  authz-csontozat erős. HÁROM KRITIKUS, keresztvalidált szivárgás javítva
  (mind a "koronaékszereket" — átvételi kód + címzett-telefon + tracking
  token — adta ki fizetés nélkül): (1) a publikus `/tracking/:token`
  (publicTracking.js) a szállító telefonját + a kódot paid_at NÉLKÜL adta →
  a feladó a saját tokenjével kiolvasta = PROVIDER-FÜGGETLEN díj-megkerülés,
  MOST élt; gate paid_at mögé (a legitim címzett post-pay kapja a linket).
  (2) `GET /carrier-routes/:id/along-jobs` (carrierRoutes.js) és (3) a
  `/backhaul/*` (backhaul.js) SCRUB NÉLKÜL adták a nyers `SELECT j.*` sort →
  a szállító a járat "útba eső fuvarjaiból"/visszafuvar-ajánlásaiból learatta
  a kódot+PII-t; scrubJobForUser map mindkettőn. +4 teszt. Backend 502/502.
  ⚠️ MARADÉK (külön PR-ek jönnek): a Barion-webhook body-trust
  (payments.js:40 — CIB-launchkor auth nélküli fizetés-megkerülés,
  keresztvalidált), socket-role a JWT-ből (realtime.js), rate-limit
  hamisítható XFF-kulcs, fiók-törlés R2-árvák, mentős-kapu, currency-
  arbitrázs, 2 db 500-on-input. A pénz-integritás pontszám a webhook-fix-ig
  alacsony marad
- **Fizetési visszahozó háló — a több-ügynökös átvizsgálás #1 TERMÉK-találata
  (2026-08-09, user-kérés)** — a megállapodás (accepted) után, de a
  kapcsolatfelvételi díj kifizetése ELŐTT a tranzakció védtelen volt (a
  platform bevétele ezen a lépcsőn akad el a leggyakrabban). Két rés zárva:
  **(1)** a `notifyDealClosed` 'carrier' ágán (a szállító elfogadja a feladó
  ellenajánlatát) a FELADÓ — a fizető, aki jellemzően nincs az oldalon —
  eddig CSAK in-app értesítést kapott, emailt nem; most `sendPaymentDueEmail`
  is megy (a query bővítve a feladó email-jével). **(2)** Új napi
  `runPaymentReminders` job (`services/paymentReminders.js`, index.js
  ütemezi): az accepted + `paid_at IS NULL` fuvarra 24h után az 1., +48h a 2.
  emlékeztető (email + in-app), max 2×; a 056-os migráció a számláláshoz
  (`payment_reminder_count` + `last_payment_reminder_at`, prodon lefutott).
  ⚠️ a scrub-ALLOWLIST őr elkapta a 2 új oszlopot → a kívülálló-ágból kivéve
  (belső könyvelés). +6 teszt (célzás: 24h/48h, max 2, fizetett/lezárt
  kimarad). Backend 498/498. Következő javasolt lépcső (a termék-ügynök
  listájából): fuvar-dátum mező (a web hiányzik, a backend kész) +
  ár/„Azonosított szállító"-jelvény a döntési pontokra
- **Díj-védelem csomag — a több-ügynökös átvizsgálás #1 találata (2026-08-09,
  user-kérés)** — a platform EGYETLEN bevételét (kapcsolatfelvételi díj) és
  az adatintegritást védő 4 guard, mind kód-igazolt réssel: **(1)
  kapcsolat-szivárgás szűrés MINDEN fizetés-előtti szabad-szövegen** — a
  `detectContactLeak` eddig csak 2 csatornán futott (chat, Q&A), most a
  `firstContactLeak` helperrel a beíró-pontokon: fuvar cím+leírás (jobs POST),
  ajánlat-üzenet (bids), járat leírás+jármű-leírás (carrierRoutes POST+PATCH),
  foglalás-jegyzet, profil bio+jármű+cégnév (auth PATCH /me + REGISZTRÁCIÓ is,
  hogy a PATCH-kapu ne legyen megkerülhető). A telefon/rendszám legitim
  mezők érintetlenek. **(2) A címzett-mezők (recipient_*) csak paid_at UTÁN a
  szállítónak** — eddig a `carrier_id` az elfogadáskor beállt, a `paid_at`
  viszont csak fizetéskor, így a kijelölt szállító a scrubJobForUser/
  scrubBookingForUser carrier-ágán fizetés ELŐTT kiolvasta a recipient PII-t
  → a feladó saját magát megadva címzettként a díj kikerülhető volt. Most
  mindkét scrub kapuzza a recipient-et. **(3) Self-delete adatvesztés-guard**
  — a `DELETE /auth/me` csak `jobs`-ot nézett ('accepted'/'in_progress'),
  se foglalást, se disputed-et, se fizetettséget → egy user self-delete-tel
  megsemmisíthette MÁS feladók fizetett foglalásait (CASCADE) és a vitás
  ügylet 5 éves bizonyíték-zárolását. Új közös helper
  `utils/activePaid.js:userHasBlockingDealings` (aktív+fizetett VAGY
  disputed, job+booking, mindkét oldal), amit a self-delete ÉS az admin-
  törlés is használ (a disputed-védelem így az adminra is kiterjedt).
  **(4) Reopen-plafon** — a díjmentes újraválasztás korlátlanul ismételve
  kontakt-aratás volt (1 díj → az összes ajánló telefonszáma); most 5
  újranyitás a plafon (`REOPEN_LIMIT_REACHED`). +14 díj-védelem teszt + a
  pii-szivargas teszt a helyes (kapuzott) viselkedésre frissítve.
  Backend 492/492
- **Ingyen skálázás-tuning: DB-pool 10→30 (2026-08-09, user-kérés)** — a
  k6 plafon-teszt kimutatta, hogy a DB-kötött végpontok fő szűk
  keresztmetszete a `pg.Pool` alapértelmezett 10-es `max`-ja volt. 30-ra
  emelve (`db.js`, env-vezérelt `DB_POOL_MAX`) → ~3× kapacitás a DB-kötött
  útra, nulla forintért. IGAZOLTAN biztonságos: a prod a Neon PgBouncer-
  poolerén megy (`…-pooler…` host), a Postgres `max_connections=901`, a 30
  elenyésző. +1 őr-teszt (db-pool.test.js: a max ne csússzon vissza 10-re).
  ⚠️ A **keep-alive ping SZÁNDÉKOSAN NEM került vissza** a cold-start ellen:
  a PR #70 pont azért vette ki (0-24 ébren tartotta a Neont → valószínű
  kvóta-kifutás → éles DB-leállás kockázata). A cold-start (~1,6 mp alvás
  után) valódi megoldása a Neon FIZETŐS tervén az autosuspend kikapcsolása
  (az „1. skálázási lépcső", nem ingyenes) — ne tegyük vissza a pinget!
- **Admin-üzenetküldés utólagos átvizsgálásának javítás-köre (2026-08-08)**
  — a friss feature-t „külsős csapat" szemmel átnézve 8 hibát találtunk és
  javítottunk. A legfontosabb (P2): a körüzenet „Szállítók" célzása a
  `role='carrier'`-en ült, de a WEB-REGISZTRÁCIÓ SOSEM AD carrier szerepet
  (mindenki 'shipper'-ként jön létre; prod-adattal bizonyítva: 16 shipper /
  1 carrier) → a célzás mostantól `role='carrier' OR
  driver_terms_accepted_at IS NOT NULL`, a „Feladók" pedig „adott már fel
  fuvart" (EXISTS jobs). ⚠️ TANULSÁG: a `users.role` a web-flow-ban NEM
  szegmentálásra való — a tényleges működés jele a driver_terms /
  jobs-előzmény. Továbbá: (2) admin-levelezés RETENCIÓJA (3 év, napi job a
  retention.js-ben — Fgytv. 17/A. § panasz-mércéhez igazítva; adatkezelési
  tájékoztató 5. szakasz + 30. cikk nyilvántartás 11. pont frissítve);
  (3) harang-badge fix: a /uzenetek megnyitása a notification-sorokat is
  olvasottra állítja (email-linkes érkezésnél égve maradt volna);
  (4) csatorna-lezárás (055-ös migráció: `admin_channel_closed_at`; a
  szál-modalban Lezárás/Megnyitás gomb; zárva a user 403 CHANNEL_CLOSED-ot
  kap, az admin írhat); (5) az admin Üzenetek fül élőben frissül
  (socket `admin-dm:new`); (6) körüzenet-email megszakadás → Sentry-riasztás
  (sms.js mintájára; a memóriabeli sor deploy-veszteség ISMERT korlát,
  kommentelve); (7) „Üzenetek" menüpont a fejléc-dropdownban; (8) fontSize
  10→11 design-szabály. +6 backend teszt (P2-regresszió őrrel) + 3 új
  browser-E2E (18-as spec: composer/modal/válasz/körüzenet-dialógus)
- **Admin ↔ user üzenetküldés + teljes user-részletnézet (2026-08-08,
  user-kérés)** — három új képesség az adminon: (1) **közvetlen üzenet** egy
  felhasználónak (Felhasználók fül boríték-gombja / Üzenetek fül szálai;
  in-app értesítés + opcionális email); (2) **körüzenet** célcsoportnak
  (mindenki / feladók / szállítók / céges fiókok; email opcióval — a
  körüzenet-emailek HÁTTÉRBEN, ütemezve mennek a Resend-limit miatt);
  (3) **teljes user-részletnézet** (`GET /admin/users/:id`, Info-gomb):
  céges/számlázási adatok, email_verified, NAV-eredmény, jármű, referral,
  forgalmi számok — a DAC7-adat (adóazonosító, születési dátum) SZÁNDÉKOSAN
  nem jelenik meg (adat-minimalizálás), csak a megadás ténye (has_tax_data).
  ⚠️ FŐ SZABÁLY (user-döntés): a felhasználó MAGÁTÓL NEM írhat az adminnak
  — a válasz-csatorna CSAK közvetlen ('direct') üzenettől nyílik meg, a
  körüzenet NEM nyitja (különben az első körüzenet után mindenki írhatna;
  403 NO_CHANNEL). User-oldal: `/uzenetek` (élő socket-frissítés,
  olvasás-visszajelzés mindkét irányban). 054-es migráció (admin_messages +
  admin_broadcasts). +13 backend teszt + szerep-lefedettség + oldal-leltár
- **Admin user-törlés adatvesztés-védelem (2026-08-08, átvizsgálás)** — az
  admin user-törlés csupasz `DELETE FROM users` volt, guard nélkül. Két gond:
  (1) az admin véletlenül törölhette SAJÁT MAGÁT; (2) egy szállító törlése a
  `carrier_routes.carrier_id` CASCADE → `route_bookings.route_id` CASCADE
  láncon át MÁS feladók FIZETETT, folyamatban lévő foglalásait is
  megsemmisítette volna (a fuvar-ág ettől védett: `jobs.carrier_id` ON DELETE
  SET NULL — a feladó fuvarja megmarad; a foglalási ág volt aszimmetrikusan
  fragilis). Guard: ön-törlés tiltva; aktív + fizetett ügyletben (job VAGY
  booking, bármelyik oldalon) lévő user nem törölhető (`USER_HAS_ACTIVE_PAID`,
  409) — előbb le kell zárni. Terminál/fizetetlen ügyletnél a törlés szabad.
  +6 teszt. Ugyanez a guard kiterjesztve az admin route/job/booking törlésre is (`HAS_ACTIVE_PAID`, 409 — a járat-törlés kaszkádolna a fizetett foglalásokra; +3 teszt). A `bid`-törlés érintetlen (nincs pénz). ⚠️ A copy-átvezetés (QVIK→CIB) tiszta: a UI SOSEM nevezte meg a
  providert, a chatbot már „bankkártyával" fizetést ír (CIB-helyes) — nincs
  átírandó felhasználói szöveg
- **CIB-fizetésre felkészítés + provider fail-loud (2026-08-08, user-döntés:
  a launch NEM QVIK, hanem CIB kártyás vPOS)** — a `paymentProvider.js`
  korábban `name() === 'qvik' ? qvik : barion` volt: MINDEN nem-'qvik' érték
  (köztük a launch `cib`-je ÉS bármelyik elgépelés) CSENDBEN visszaesett
  Barionra → kulcs nélkül stub → az oldal „élesben" futott volna, de NULLA
  díjat szedett volna be, és a confirm-payment guardok kinyíltak volna. Ez a
  launch legveszélyesebb NÉMA hibája lett volna. Három védelem: (1) `cib.js`
  skeleton a CIB vPOS-hoz (a qvik.js mintájára); (2) explicit provider-térkép
  `{barion,qvik,cib}` + fail-loud: ismeretlen `PAYMENT_PROVIDER` → HANGOS
  hiba, nem néma Barion-visszaesés; (3) boot-ellenőrzés az index.js-ben:
  ÉLES (production) futás + stub provider → prominens hiba a logban („nulla
  díj, guard nyitva"). +9 teszt. AKTIVÁLÁS: `PAYMENT_PROVIDER=cib` +
  `CIB_API_KEY`/`CIB_MERCHANT_ID`/`CIB_BASE_URL` + a cib.js két TODO-ja +
  `/payments/cib/callback`
- **Részletes átvizsgálás 2. kör — foglalás-fizetés provider-hiba (2026-08-08)** —
  ⚠️ LAUNCH-KRITIKUS: a foglalási (Járat) ág a fuvar-ággal ellentétben
  KÖZVETLENÜL a barion-t hívta (`barion.startFeePayment` + a confirm-payment
  guard `barion.isStub()`-ot nézett), NEM a `paymentProvider` absztrakciót.
  Mivel a launch QVIK-re vált (Barion elvetve), a `barion.isStub()` TRUE lett
  volna → (1) a foglalás-díj a stub Barionra ment volna, nem valódi QVIK-re
  (a Járat-díj nem szedődik be), (2) a confirm-payment guard KIKAPCSOL →
  bárki fizetés nélkül fizetettnek jelölheti a saját foglalását. A hiba
  LAPPANGÓ volt (most minden stub), de pont a QVIK-átállásnál aktiválódott
  volna. Javítva: a foglalási ág is a `paymentProvider`-t használja (mind a
  3 hívás). +3 teszt, a hibás guardon igazoltan piros. Az SSRF-felület
  (link-preview host-allowlist, geocode/vat/barion fix hoszt + kódolt param)
  és a tároló-kulcsok (random hex név + regex-validált kiterjesztés, nincs
  path-traversal) ELLENŐRIZVE ÉS RENDBEN
- **Részletes átvizsgálás — kupon double-spend javítva (2026-08-08)** —
  profi-csapat stílusú, modulonkénti kézi átolvasás valós hibát keresve. A fő
  találat: a `useVoucherIfAvailable` (gamification.js) külön SELECT + UPDATE
  volt, zárolás nélkül → egy ajánlói kuponnal PÁRHUZAMOS fizetéssel több
  fuvar díja is elengedhető volt (bizonyítva: 8 egyidejű beváltásból 7-8
  sikerült egy kuponra). Javítva egyetlen atomi UPDATE-tel
  (`FOR UPDATE SKIP LOCKED`), +6 teszt. ⚠️ TANULSÁG: az első reprodukciós
  próba 2 szálon „átment" (hamis zöld) — versenyteszthez elég szál kell (8).
  A többi kritikus út ELLENŐRIZVE ÉS RENDBEN: ajánlat-elfogadás
  (`FOR UPDATE`), azonnali fuvar és mentős elfogadás (guarded UPDATE +
  rowCount), jelszó-reset (hash + lejárat + egyszer-használat + token_version
  bump), értékelés-duplikáció (DB UNIQUE), rating-aggregáció (forrásból
  újraszámol, nincs drift), retenció-törlés (a `photo_retention_hold` zárolt
  vitás bizonyítékot 5 évig őrzi), fizetési webhook (korábbról). ⚠️ NYITOTT
  DÖNTÉS a usernek: a referral havi plafon (5) elérésekor a meghívott
  „granted"-re áll, de az ajánló kupon nélkül marad, és NINCS újrapróba —
  a 6.+ ajánlás jutalma véglegesen elveszik. Ez policy-kérdés (deferred
  reward vs. hard cap), nem javítottam egyoldalúan
- **A leggyengébb két modul felhozva (2026-08-07)** — a mutációs mérés
  `mask.js` 3% és `rateLimit.js` 23% pontszámát célzottan javítottuk.
  Eredmény: **mask.js 3% → 97%**, **rateLimit.js 23% → 59%** (együtt
  17,5% → 69,8%), +24 teszt. Mindkettő CSENDES garanciát véd: a maszkolás
  azt, hogy a Railway-logba ne kerüljön teljes e-mail/telefonszám
  (adattakarékosság a naplókra is vonatkozik), a rate limit pedig a
  brute-force és spam elleni első védvonal. A tesztek szándékosan a
  HATÁROKAT feszegetik (pont a limiten, eggyel fölötte, ablak-forduló), mert
  a mutáció épp ott mutatott vakságot. ⚠️ Külön értékes: az ÉLES limiterek
  konfigurációját (kulcsolás, max, ablak) addig SEMMI nem őrizte — ha valaki
  a `writeRateLimit`-et user-alapúról IP-alapúra állítja, egy irodából/mobil-
  hálózatról érkező felhasználók kizárnák egymást, és egyetlen teszt sem
  szólt volna. ⚠️ SZÁNDÉKOSAN NEM hajszoltuk 100%-ra: a maradék 30 túlélő
  többsége „egyenértékű mutáns" (belső vödör-név, felhasználói szöveg,
  process-kilépési apróság) — megölésükhöz pontos szöveg-egyezésre kellene
  tesztelni, ami minden szöveg-változtatásnál pirosra váltana, valódi haszon
  nélkül. Ez a csökkenő hozadék határa
- **Teszt-minőség: audit, lefedettség-padló, fizetési webhook, mutációs
  tesztelés (2026-08-07)** — a „mit mondana egy tapasztalt fejlesztő" kérdésre
  mérésekkel válaszoltunk. **(1) Függőség-audit** (`scripts/fuggoseg-audit.js`,
  CI-ban): a mérés 3 magas (backend) és 6 magas (web) ÉLES sérülékenységet
  talált; `npm audit fix`-szel a backend 3→0, a web 6→2 (a maradék kettő —
  next, postcss — Next.js 14→16 fő verzióugrást igényel, ezért ÍRÁSOS
  INDOKLÁSSAL elfogadva; az őr az elavulást is figyeli). Csak production
  függőségre és csak high/critical szintre kapuz — dev-eszközre kapuzni
  hozzászoktatna a piros buildhez. **(2) Lefedettség-padló**
  (`scripts/lefedettseg-or.js`, CI-ban): ⚠️ a vitest saját `thresholds`-a
  NEM használható kapuként — kiírja a sértést, de NULLA kóddal lép ki
  (lemérve: 99%-os küszöbbel is zöld maradt a build). Saját őr olvassa a
  json-summary riportot, és véd az ELAVULT riport ellen is (magam estem bele).
  Jelenleg 74,3% sor / 61,9% elágazás. **(3) Fizetési webhook** (+13 teszt):
  a pénz-út legkritikusabb pontja addig kivételként szerepelt. Most őrzi a
  sikeres fizetést, az idempotenciát (ugyanaz kétszer, tíz párhuzamos), az
  ismeretlen/idegen azonosítót, a sikertelen státuszokat — és a két
  legfontosabbat: HAMISÍTOTT „Succeeded" POST nem fizet ki semmit (a kód a
  PSP-től olvassa vissza az állapotot), illetve PSP-hiba esetén NEM
  könyvelünk, hanem 5xx-szel újrapróbálást kérünk. **(4) Mutációs tesztelés**
  (Stryker, `npm run test:mutation`, NEM CI-eszköz — ~1 óra, egyszálú, mert
  a teszt-DB fix porton indul): 836 mutáns a pénz-/biztonsági magon,
  **39,5% pontszám**. A connectionFee 100%, a contactGuard 10% —
  ⚠️ **ez vezetett a legfájóbb eddigi hibához**: a chat (`POST /messages`)
  SOHA nem alkalmazta a kapcsolat-szivárgás szűrőt, csak a kérdés-válasz
  felület. A CLAUDE.md üzleti szabályként rögzítette és a jobs.js kommentje
  is állította, hogy szűr — de meg sem volt írva. Mivel a platform egyetlen
  bevétele a kapcsolatfelvételi díj, a felek a chatben elküldött
  telefonszámmal teljesen megkerülhették volna. Javítva (a szűrés CSAK a díj
  kifizetése ELŐTT fut — utána a kontakt jogosan jár), +15 teszt valós
  megkerülési trükkökkel. ⚠️ TANULSÁG: a 16-os oldal-lefedettségi spec
  404-heurisztikája a puszta „404" sztringre illesztett, ami a véletlen
  6 jegyű átvételi PIN-ben is előfordul („548404") — a valódi 404-oldal
  címsoraira cserélve
- **Űrlap-hibaüzenetek böngészőben (2026-08-07)** — az utolsó rés a
  lefedettségben. A rossz értékek kezelését eddig KÉT helyen őriztük
  (backend: 16-féle szemét minden mezőbe; web logika: 20 unit teszt a
  validációs függvényekre), de EGYIK SEM nézte, hogy a böngészőben a user
  kap-e értelmes magyar magyarázatot. Egy tökéletes validációs függvény
  semmit nem ér, ha a hibaüzenet nem jelenik meg, vagy nem ahhoz a mezőhöz
  tartozik. `web/e2e/17-urlap-hibauzenetek.spec.ts` (8 teszt) a FELÜLET
  szemszögéből néz: negatív érték be sem írható · tört érték egész mezőben
  látható hibaüzenetet kap ÉS nem alakul át csendben (12,5 cm ≠ 125 cm) ·
  üres kötelező mező MEGNEVEZVE kap üzenetet · a hibás űrlap el sem indít
  kérést a szerver felé · „más veszi át" → címzett neve+telefonja kötelező
  (külön üzenet a szemét és a túl rövid számra) · csak várost választva a
  cím elutasítva, házszámmal elfogadva · a javítás után a feladás végigmegy ·
  múltbeli járat-indulás figyelmeztetést kap és nem publikál.
  ⚠️ A szelektorok az ŰRLAPON BELÜLI hibára szűkítenek (`form` scope): a
  toast szándékosan ugyanazt a szöveget mutatja, de a mező melletti
  magyarázat az, ami javítani segít. Ellenőrizve, hogy a tesztek tudnak
  bukni (a beviteli szűrés ideiglenes kivételével)
- **Böngészős oldal-lefedettség (2026-08-07)** — az API-oldali rés lezárása
  után a böngészős maradt nyitva: a 47 oldalból az E2E ~11-et látott. Ha egy
  oldal fehéren elszáll (rossz import, null-hivatkozás, elrontott hook), azt
  SEMMILYEN API-teszt nem veszi észre, mert a backend rendben válaszol.
  `web/e2e/16-oldal-lefedettseg.spec.ts` (48 teszt) MINDEN oldalt megnyit a
  hozzá tartozó szereplővel (anon / feladó / szállító / admin), és négy
  dolgot ellenőriz: a dokumentum betöltődik, nincs kezeletlen JS-kivétel
  vagy konzol-hiba, tényleg van renderelt tartalom (nem üres, nem 404), és
  nem látszik nyers hibaállapot („Szerverhiba", „Cannot read propert…").
  A dinamikus oldalak valódi fixture-t kapnak (fuvar, licites fuvar, járat,
  követési token). ⚠️ **ÖNVÉDŐ LELTÁR-ŐR**: a spec bejárja az `app/` fát, és
  elhasal, ha új `page.tsx` kerül be, ami nincs a leltárban — a hibaüzenet
  még a beillesztendő sort is megírja. Így a böngészős lefedettség sem tud
  némán visszacsúszni. ⚠️ TANULSÁG a szűrésről: a böngésző konzol-HIBAKÉNT
  naplózza a kezelt 4xx válaszokat is (érvénytelen email-token → 400, idegen
  fuvar részlete → 403) — ezek NORMÁLIS működés, ezért elnézettek; az **5xx
  viszont SZÁNDÉKOSAN nem**, az valódi összeomlás
- **Szerep-lefedettség: a feladói ÉS a szállítói felület minden végpontja
  (2026-08-07)** — a „mindkét oldal teljesen tesztelve van?" kérdésre nem
  tippeltünk, hanem MÉRTÜNK: műszereztük a teszt-appot, és rögzítettük,
  melyik végponton fut le valaha SIKERES hívás. Az eredmény kijózanító volt:
  a 126-ból csak **42**. A többit a jogosultság-batteryk csak hibaágon
  „érintették" (401/403) — egy 401 viszont nem bizonyítja, hogy a végpont a
  helyes választ adja annak, akinek szabad. `tests/szerep-lefedettseg.test.js`
  (37 teszt) mostantól MINDEN végpontot a jogosult szereplővel hív meg:
  publikus felület, közös (profil/értesítés/chat/KYC), **feladói** (fuvarjaim,
  ajánlat-kezelés, ellenajánlat, kérdés-válasz, járat-böngészés és foglalás,
  viták, értékelés, SOS), **szállítói** (elérhető fuvarok, ajánlataim,
  járat-CRUD + státusz + útba eső, visszafuvar, útvonal-figyelő teljes
  életciklusa, statisztika/dashboard, foglalás-kezelés, azonnali fuvar,
  élő pozíció, DAC7 adóazonosító), mentős flow, admin felület, fiók-törlés.
  ⚠️ **ÖNVÉDŐ LEFEDETTSÉG-ŐR**: a fájl végén álló teszt elhasal, ha új
  végpont kerül a rendszerbe, amit itt senki nem hív le sikeresen — és nincs
  rá írásos indok a `KIVETELEK` listában (jelenleg 6 tétel, mind indokolt:
  külső HTTP, PSP-webhook, email-tokenes ág, NAV-kulcs, élesben tiltott
  végpont). A lista elavulását is figyeli. **Találat:** a
  `src/routes/favorites.js` (kedvenc szállítók) LÉTEZETT, de SOSEM lett
  bekötve az index.js-be, és a frontend sem hívta — halott kód, ami a
  kódtérképen élő funkciónak látszott. **User-döntés (2026-08-07): TÖRÖLVE**
  — a route-fájl és a `favorite_drivers` tábla is (052-es migráció; az éles
  táblában 0 sor volt, és nem is keletkezhetett adat, mert a végpontok
  elérhetetlenek voltak)
- **„Teljes út" életciklus-mátrix (2026-08-07, user-kérés: „mindent fedjen
  le, a futásidő nem izgat")** — `backend/tests/teljes-ut.test.js`, 156 teszt.
  Amit egyik korábbi réteg sem fedett: a hülyebiztos-matrix EGY kérést
  vizsgál, az E2E a boldog utat járja — de azt SENKI nem nézte, hogy egy
  fuvar ÉLETÚTJÁNAK MINDEN PONTJÁN ki mit tehet. Felépítés: (1) a boldog
  ösvény végigjárása invariáns-ellenőrzésekkel (kontakt CSAK fizetés után,
  rossz kóddal nincs lezárás, pontosan egy díj-sor); (2) **ÁLLAPOT ×
  SZEREPLŐ × MŰVELET teljes mátrix** a fuvar-ágra (7 állapot × 5 szereplő ×
  12 művelet) és a **járat-foglalás ágra** (8 állapot × 5 szereplő ×
  8 művelet) — az elvárás-tábla egyben a rendszer írott szabálykönyve;
  (3) kereszt-szennyeződés (másik fuvar kódja/ajánlata); (4) félbehagyott
  utak (otthagyott fizetés, szállító-csere, dupla kattintás).
  ⚠️ Minden mátrix-cella SAJÁT, FRISS fuvart kap → sorrend-független.
  **Talált és javított hibák:** (a) **kézbesíteni lehetett felvétel nélkül**
  — a szállító átugorhatta a felvételi fotót és egyből lezárhatta a fuvart,
  így a felvételkori állapotról semmilyen bizonyíték nem keletkezett (a
  fotó-bizonyíték hirdetett bizalmi réteg!); érdekes módon a JÁRAT-ágon ez a
  guard MEGVOLT — a két folyamat csúszott szét, most a fuvar-ág is kapott
  `PICKUP_REQUIRED_FIRST`-öt; (b) **lezárt fuvarra is lehetett GPS-pozíciót
  küldeni** (kézbesített ÉS lemondott fuvarra is) — értelmetlen szemétadat,
  ami a GDPR-adattakarékosság ellen megy; most 409 `JOB_CLOSED`.
  ✅ **RENDEZVE (2026-08-07, user-döntés):** a `disputed` addig EGYIRÁNYÚ
  UTCA volt — a vita lezárása nem állította vissza a fuvar státuszát, az
  örökre `disputed` maradt. Az 053-as migráció bevezette a
  `status_before_dispute` oszlopot (jobs + route_bookings): a vita
  megnyitása elteszi az akkori státuszt, a lezárása (`resolved_*`/`closed`)
  visszaállítja, majd üríti. Ettől a `disputed` átmeneti állapot lett, és
  ezért lehetett szigorítani is: **vita alatt NEM lehet lemondani** (nem
  lehet lemondással kimenekülni a vita alól). ⚠️ A fizikai út viszont
  SZÁNDÉKOSAN folytatódhat: ha a vita megnyitásakor a csomag már úton volt,
  a szállító KÉZBESÍTHET — különben beragadna a címzett kapujában egy nyitott
  vita miatt. Ilyenkor a `disputed` státusz MARAD (egy fotó nem tüntetheti el
  a vitát), csak a `delivered_at` és a „hova térünk vissza" érték áll
  'delivered'-re. A `photo_retention_hold` a lezárás után is bekapcsolva
  marad (5 éves bizonyíték-őrzés). +6 teszt a vita életciklusára, a foglalási
  ágra is
- **QR kód kivezetve — csak a 6 jegyű PIN marad (2026-08-06, user-döntés)** —
  „csak bonyolítja az esetet". Technikailag is helyes volt a döntés: a QR
  SOSEM működött végig — olvasó SEHOL nem volt a rendszerben (a
  `parseQrContent` helpert semmi nem hívta), a szállító mindig kézzel gépelte
  be a kódot. A QR tehát dísz volt, ami két úton gondolkodtatta el a
  felhasználót ott, ahol egy sem kellett volna. Törölve: `QrCode.tsx`,
  `backend/src/utils/qr.js`, a `qrcode` npm-függőség. Helyette
  `web/src/components/DeliveryPin.tsx` (nagy, tagolt, színes kártyán is
  olvasható — a régi QR-komponens a `var(--text)`-et használta, ami a kék
  háttéren gyenge kontrasztot adott). Szöveg-átvezetés: nyomon-követő oldal,
  fuvar-részletek, új fuvar űrlap, a címzett „mindjárt érkezik" emailje, és a
  chatbot-tudás (a bizalmi lánc 5 → 4 rétegű). ⚠️ SZÖVEG-SZABÁLY: „QR" a
  felületen TILOS — a szövegőr (13-as spec) őrzi. A QVIK fizetési QR MÁS
  fogalom (a bankappban), az marad
- **Teszt-harness stabilizálás (2026-08-06)** — a backend-suite kb. minden
  8-12. TELJES futásán elbukott egy VÉLETLENSZERŰ teszt „socket hang up"-pal.
  Nem alkalmazás-hiba: a supertest a `request(expressApp)` alakban MINDEN
  hívásra új szervert nyit egy efemer porton — a hülyebiztos-matrix ~1500
  plusz kérése ezt láthatóvá tette (a hiba régi tesztet is eltalált, nem csak
  az újat). Javítás: a `tests/helpers.js` egyetlen, MÁR FIGYELŐ szervert
  exportál `app` néven (`unref()`-fel), így a supertest csak csatlakozik.
  A route-leltárnak kell a nyers Express példány is → `expressApp` külön
  exportálva. Igazolás: 0 bukás 15 teljes futásból (előtte ~1/10).
  Ráadás: a matrix `fire()` helpere transzport-hibára egyszer újrapróbál, de
  KÉTSZERI elszállásnál elbukik — a néma retry-ciklus pont az a hamis zöld
  lenne, ami ellen a suite szól
- **„Hülyebiztos" adversarial matrix + AI felderítő tesztelő (2026-08-06)** —
  a tesztelői alapelv gépesítve: *a user el fogja rontani*. Három új réteg:
  **(1) `backend/tests/hulyebiztos-matrix.test.js`** — nem egy-egy hibát őriz,
  hanem NÉGY egyetemes szabályt, amit egyetlen végpont sem szeghet meg
  (SZ1 soha 500 / SZ2 ami zárt az zárt / SZ3 ami titok az titok / SZ4 nincs
  belső részlet a válaszban). A végpont-listát FUTÁSIDŐBEN az Express
  router-stackből olvassa (`tests/routeInventory.js`), és a
  `tests/routeManifest.js`-hez méri: **új végpont manifest nélkül = piros
  build** — nem lehet véletlenül kapuzatlan végpontot élesíteni (126 végpont
  besorolva; publikushoz kötelező írásos indok). Támadások: token nélkül /
  idegen userrel / admin-jog nélkül minden végpontra, 11-féle szemét a
  path-paraméterbe, 16-féle mutáció minden body-mezőbe, dupla-kattintás
  pénz-invariánsok. **5 valódi hibát talált azonnal** (lásd lent).
  **(2) `web/e2e/13-szovegor.spec.ts`** — a CLAUDE.md szöveg-szabályai
  (nincs „GoFuvar Kft.", nincs „letét", nincs „licit", nincs app-ígéret,
  nincs „jogosítvány" a marketingben) a MEGJELENÍTETT szövegen ellenőrizve
  12 marketing-oldalon. Ezek eddig többször visszacsúsztak, mert semmilyen
  teszt nem fogta őket. A jogi oldalak szándékosan kimaradnak (ott a tagadó
  szerkezet legitim: „a fuvardíjat nem tartja letétben").
  **(3) `web/e2e/14-konzol-tisztasag.spec.ts`** — a fő oldalak betöltése ne
  írjon hibát/React-figyelmeztetést a konzolra.
  ⚠️ **`web/scripts/ai-tesztelo.mjs`** — LLM-vezérelt felderítő böngésző-
  ügynök (Claude vagy Gemini; `ANTHROPIC_API_KEY` vagy a meglévő
  `GEMINI_API_KEY`). NEM CI-eszköz: lassú, fizetős, nem determinisztikus, és
  a találatait EMBERNEK kell triázsolnia. Az értéke az ÚJ hibaosztály
  megtalálása — amit talál, abból determinisztikus tesztet írunk. A benne
  lévő passzív műszer (konzol-hiba, 5xx, elakadt kérés) LLM nélkül is mér.
  Élesbe SOSEM megy (`ELES_ENGEDELY` nélkül megtagadja: adatot hozna létre).
  Használat: `cd web && node scripts/ai-tesztelo.mjs`;
  szerepek: `SZEMELY=rosszindulatu|zavarodott|turelmetlen`.
  **A megtalált és javított hibák:** (a) a `POST /jobs` válasza a NYERS sort
  adta vissza, így a feladó EGYETLEN helyen — épp a létrehozáskor — megkapta
  a CÍMZETT átvételi kódját, holott a `scrubJobForUser` mindenhol máshol
  elveszi tőle (a kód-garanciát gyengítette a „más veszi át" flow-ban).
  ⚠️ A feladó VÉSZHELYZETI kódja (`sender_delivery_code`) ÉRINTETLEN: azt
  továbbra is megkapja, a backend elfogadja a lezáráskor, és naplózza, hogy
  ezzel zárult (`closed_by_code_type='sender_emergency'`) — csak a CÍMZETT
  kódját vettük el tőle. Ennek kapcsán derült ki (2026-08-06), hogy a
  feladói kód-kártya SZÖVEGE félrevezető volt, ha nincs külön címzett (a
  „Nem én veszem át" checkbox óta ez az ALAPESET): a riasztó „🆘 Vészhelyzeti
  kód (csak ha a címzett nem elérhető!)" kártya jelent meg azzal, hogy „a
  címzett SMS-ben megkapta" — pedig nincs címzett. A normál kódot QR-ral
  mutató ág pedig HALOTT KÓD volt (feltétele: `delivery_code &&
  !sender_delivery_code` — sosem teljesülhetett), vagyis a feladó a saját
  QR-kódját SOSEM látta. A kártya mostantól alkalmazkodik: van címzett →
  vészhelyzeti keret; nincs címzett → „🔐 Átvételi kódod" + QR. Őrzi:
  `web/e2e/15-atveteli-kod-feladonak.spec.ts` (azt is, hogy a CÍMZETT kódja
  sehol nem jelenik meg a feladónak);
  (b) null-bájt bármelyik path-paraméterben → Postgres UTF8-hiba → 500
  (központi szűrő az `index.js`-ben zárja az egész osztályt);
  (c) a szerepkör a JWT payloadból jött, nem a DB-ből → egy lefokozott admin
  a token lejártáig (1 nap) admin maradt; most az `authRequired` a DB-ből
  olvassa (a lekérdezés a token_version miatt amúgy is lefut);
  (d) `.trim()` típus-ellenőrzés nélkül 4 végponton (vita, üzenet, kérdés,
  válasz) → nem-string mezőre 500; közös `utils/text.js` (`requireText`)
  zárja az osztályt; (e) hibás/csonka JSON-test → 500 „Szerverhiba" 400
  helyett — élesben ez MINDEN megszakadt mobil-kérésnél hamis Sentry-riasztás
  lett volna. Ráadásként az AI-tesztelő passzív műszere elkapta, hogy a
  téma-kapcsoló (PR #100) React-hidratálási figyelmeztetést írt minden
  oldalbetöltésnél (`suppressHydrationWarning` a `<html>`-en; a 14-es spec
  őrzi — ellenőrizve, hogy a javítás nélkül tényleg piros)
- **Téma-kapcsoló: világos / sötét / rendszer (2026-08-04, tesztelői kérés)** —
  a fejlécben ikon-gomb (nap / hold / monitor), belépés nélkül is elérhető,
  körbelépteti a három állapotot. ⚠️ ARCHITEKTÚRA-VÁLTÁS: a dark mode NEM a
  `@media (prefers-color-scheme: dark)`-on ül többé (azt JS-ből nem lehet
  felülbírálni), hanem a **`<html data-theme="light|dark">`** attribútumon —
  a globals.css minden dark szabálya `[data-theme='dark']` prefixet kapott.
  A rendszer-beállítás MARADT az alapértelmezés (és „rendszer" módban élőben
  követi az OS-váltást is). A villanás ellen a `layout.tsx` <head>-jébe tett,
  festés előtt futó inline szkript állítja be az attribútumot
  (`THEME_BOOT_SCRIPT`); ez szándékosan duplikálja a `src/lib/theme.ts`
  logikáját (bundle-ból importálva már késő lenne) — a `theme.test.ts`
  LEFUTTATJA a szkriptet, hogy a két példány ne csúszhasson szét. A választás
  a `gofuvar_theme` localStorage-kulcsban él; „rendszer" = nincs bejegyzés.
  Bónusz: a 08-kontraszt-audit E2E mostantól ellenőrzi, hogy tényleg a kért
  téma van érvényben — enélkül a boot-szkript elromlásakor NÉMÁN kétszer a
  világos témát auditálta volna. +17 teszt (14 unit + 3 E2E)
- **Tesztelői kör: űrlap-validációk (2026-08-04)** — 5 észrevétel javítva:
  (1) **múltbeli dátum tiltva** (járat-hirdetés `min` + JS-ellenőrzés +
  BACKEND kényszerítés `DEPARTURE_IN_PAST` a POST-on ÉS a PATCH-en; járat-
  kereső dátumszűrők `min`=ma és „Eddig" ≥ „Ettől"; DAC7 születési dátum
  max = 18 éve); (2) **/hozasd-el eszköz belépéshez kötve** — a SEO/landing
  szöveg publikus marad, az eszköz helyén „A feladáshoz belépés kell" kártya
  (user-döntés: SEO-érték megtartása); a /dashboard/uj-fuvar is kapott
  auth-kaput; (3) **szám-mezők**: negatív BE SEM ÍRHATÓ (beviteli szűrés),
  tört cm/Ft látható hibaüzenetet kap (`web/src/lib/formValidation.ts`;
  ⚠️ a tizedest NEM dobjuk el némán — a 12,5 cm-ből 125 cm lenne!), minden
  mezőn `title` tooltip + mezőnkénti magyar hibaüzenet, `noValidate` a
  formon (a natív buborék a böngésző nyelvén szólt és elnyomta a sajátunkat);
  Enter a szövegmezőkben már nem küldi el az űrlapot; (4) **házszámig pontos
  cím kötelező** a felvétel/lerakodás pontnál (user-döntés) —
  `AddressAutocomplete requirePrecise`: ország/megye/település/irányítószám
  elutasítva. ⚠️ KRITIKUS TANULSÁG: a Places legördülő magyar címeknél a
  gyakorlatban SOHA nem kínál házszámos javaslatot (mérve: „Budapest, Váci
  út 1" → mind a 10 javaslat utca vagy POI; a `types:['address']` szűrés sem
  segít) — ezért a komponens a BEGÉPELT szöveget a **Geocoderrel** oldja fel
  mentőágként (az pontosan visszaadja a street_number-t). Enélkül a szabály
  minden feladást blokkolt volna; (5) **ha más veszi át**: „Nem én veszem át
  a csomagot" checkbox → a címzett neve + telefonszáma KÖTELEZŐ (backend is:
  `RECIPIENT_INCOMPLETE` / `RECIPIENT_PHONE_INVALID`; bármelyik címzett-mező
  kitöltése kiváltja). +63 teszt (30 web unit + 18 backend + 1 E2E a
  hozasd-el kapura; a régi uj-utvonal teszt fix múltbeli dátumát relatívra
  írtuk, hogy ne rohadjon el)
- **Feladói KYC-mentesség (2026-07-19, PR #96)** — a feladónak NEM kell
  személyi igazolvány: a `requireIdentityKYC` kapu kivéve a POST /jobs +
  /pay + /confirm-payment útvonalakról (a Járat-foglaláson sosem volt);
  a szállítói kapu (requireDriverKYC a licitnél/járat-hirdetésnél)
  VÁLTOZATLAN. HomeHub feladó-módú KYC-kártya törölve, profil-oldali
  KYC-kártya „szállító-módhoz" feliratú, ÁSZF 3.2 (progresszív KYC:
  feladótól kockázat-alapon kérhető) + adatkezelési 2. szakasz +
  chatbot-tudás átírva. Referral: feladói úton a díj-fizetés a feltétel
  (KYC nélkül is jár), szállítói úton marad a KYC-ellenőrzés. +5 teszt
  (osztály-védelem az aszimmetriára: feladó mehet, szállító kapuzva)
- **Számlázz.hu számla-integráció — TELJES implementáció, csak az
  Agent-kulcs hiányzik (2026-07-19, PR #95)** — a kapcsolatfelvételi díjról
  automatikus e-számla a feladónak a díj-fizetés webhookjában
  (`services/szamlazzHu.js`: Számla Agent XML API + cím-szétbontás +
  áfakulcs-térkép HU 27 / EU fordított EUFAD37 / 3. ország HO); a számlát a
  Számlázz.hu emaili ki a vevőnek, PDF-et nem tárolunk (minden számla a
  Számlázz.hu fiókban). **KRITIKUS javítás vele: a díj BRUTTÓ árként
  számlázódik** (computeVat `amountIsGross`: 500 Ft = nettó 394 + ÁFA 106 —
  a motor eddig nettónak vette volna, és az első éles számla 635 Ft-ról
  szólt volna!). Elavult "GoFuvar Kft."/Barion/„Áfa tv. 37.§" szövegek
  javítva. Kudarc-ág: 'failed' invoices-sor, a fizetést sosem akasztja;
  kulcs nélkül stub. +11 teszt. **AKTIVÁLÁS (user-teendő, a regisztráció
  2026-07-19-én folyamatban):** (1) Számlázz.hu fiók → Beállítások →
  Számla Agent kulcs; (2) a fiókba NAV Online Számla technikai user
  bekötése (adatszolgáltatáshoz kötelező — ugyanaz jó, ami a PR #94-es
  NAV-cégellenőrzéshez készül); (3) Railway env:
  `INVOICE_PROVIDER=szamlazz_hu` + `SZAMLAZZ_AGENT_KEY`; opcionális:
  `SZAMLAZZ_E_INVOICE=false`, `SZAMLAZZ_INVOICE_PREFIX`, `COMPANY_BANK` +
  `COMPANY_BANK_ACCOUNT`
- **NAV „Ellenőrzött cég" jelvény — TELJES implementáció, csak a NAV-kulcs
  hiányzik (2026-07-19, PR #94)** — Online Számla 3.0 `queryTaxpayer`
  (`services/navTaxpayer.js`: XML + SHA-512/SHA3-512 aláírás + válasz-parse +
  cégnév-egyeztetés cégforma-normalizálással). Érvényes adószám + egyező
  cégnév → `company_verification_status='verified'` AUTOMATIKUSAN (a PR #57
  dormant plumbingja + a szállító-oldali jelvény-UI ezzel kelt életre);
  név-eltérésnél 'pending' marad + a NAV szerinti hivatalos név mentve
  (admin dönthet) → más cég adószámával nem lehet jelvényt szerezni.
  Futás: céges regisztrációkor + cégadat-változáskor automatikusan, kézzel
  a profil „Cég-ellenőrzés (NAV)" gombjával (`POST /auth/verify-company`,
  5/óra/user; a gomb csak élesített integrációnál látszik —
  `company_nav_available` a GET /auth/me-ben). Jelvény: ajánlat-kártya
  (feladó látja a szállító cégnevét + jelvényét — B2B számlaképesség-jelzés),
  publikus profil, saját profil. 050 migráció (nav_taxpayer_checked_at/
  _name/_valid) — prodon LEFUTOTT. +15 backend teszt mockolt NAV-val.
  **AKTIVÁLÁS (user-teendő, ~10 perc):** onlineszamla.nav.gov.hu →
  cég-regisztráció (ügyvezető, ügyfélkapu) → technikai felhasználó
  („Számlák lekérdezése" jog elég) → Railway env: `NAV_ONLINE_LOGIN` +
  `NAV_ONLINE_PASSWORD` + `NAV_ONLINE_SIGNKEY` +
  `NAV_ONLINE_TAXNUMBER=24750792` — kód-módosítás nem kell
- Web app teljesen (gofuvar.hu)
- Backend Railway-en, always-on
- DB migrációk
- ÁSZF + GDPR Tiszta Hód adatokkal + EU-kiegészítés
- Email verifikáció + password reset (✅ ÉLES a Resenddel, 2026-07-05)
- **Resend email ÉLES (2026-07-05)** — gofuvar.hu domain verifikálva a
  Resendben (DKIM + SPF a `send` aldomainen + DMARC, DNS a Rackhost/dns24
  panelben), `RESEND_API_KEY` + `EMAIL_FROM=GoFuvar <noreply@gofuvar.hu>`
  a Railway env-ben; élesben tesztelve (verify + jelszó-reset email
  kézbesítve gmail-re). ⚠️ TANULSÁG: az `EMAIL_FROM` nélkül a kód a
  `onboarding@resend.dev` fallbackra esik, amit a Resend 403-mal dob el —
  a Railway-logban látszik. PR #56: elavult "Letét" szlogen + nem létező
  "GoFuvar Kft." cégnév javítva (email-fejléc + web-lábléc)
- **Bejövő email ÉLES (2026-07-05)** — info@ / panasz@ (és catch-all
  miatt MINDEN @gofuvar.hu cím, a user jovany@gofuvar.hu fiók-emailje is)
  az ImprovMX-en át a user gmailjébe fut (MX mx1/mx2.improvmx.com + SPF
  a fő domainen, ingyenes csomag); end-to-end tesztelve (Resend →
  info@ → gmail kézbesítve). Fizetős postafiók NEM kell — a válaszküldés
  a Gmail "Küldés másként"-jével megy a Resend SMTP-n
- Sentry ✅ ÉLES mindkét oldalon (2026-07-05-én ellenőrizve): `SENTRY_DSN`
  a Railway-en, `NEXT_PUBLIC_SENTRY_DSN` a Vercelen (Production+Preview,
  ~2026-06 óta) — a CLAUDE.md sokáig tévesen STUB-ként tartotta nyilván
- Cookie consent, EmailVerifyBanner, DisputeButton, ReviewBox, ChatBox
- KYC AI (Gemini)
- 5 SMS flow (kód, STUB)
- Tracking, fotó, díj-fizetési logic (Barion STUB)
- **Készpénz + kapcsolatfelvételi díj modell (2026-07-03/04)** — teljes
  átállás: backend (connectionFee service, 044-es migráció:
  `connection_fee_huf`+`fee_consent_at`+`reopened_count`, díj-fizetés
  escrow helyett, kontakt-felfedés a `GET /jobs/:id` `contact` mezőjében,
  sofőr-lemondásnál auto-reopen + `POST /jobs/:id/reopen` sofőr-csere,
  webhook+számla a feladónak), web (consent-checkbox a fizetésnél,
  kontakt-kártyák, sávos díj-UI, landing/chatbot/email szövegek), ÁSZF
  teljes pénzügyi átírás (4., 5.1, 6.2, 7. szakasz)
- **Díj-visszaigazoló email + consent a /pay-en (2026-07-04, PR #51)** —
  45/2014. 18.§ tartós adathordozós visszaigazolás a feladónak (a
  nyilatkozat szó szerinti szövegével); a consent a fizetés INDÍTÁSAKOR
  rögzül (élesben a Barion-oldalon nem nyilatkoztathatnánk), a
  confirm-payment élesben tiltott (webhook a hiteles forrás)
- **Tesztelői hibák 2. köre (2026-07-04, PR #54)** — 12 közepes/alacsony
  javítás, köztük: BUG-038 adatexpozíció (kívülálló látta a paid_at-ot —
  scrub bővítve), BUG-028 (elindult útvonal 12 óráig kereshető volt → 1 óra),
  BUG-009 (PATCH /me RETURNING + profil-merge), BUG-037 (alku utáni ár a
  sofőrnél), fejléc mód-chip (BUG-034 részleges), cím/útvonalnév-validációk
- **Tesztbővítés: 5 osztály-teszt (2026-07-05, PR #55)** — gonosz-input
  suite (írási végpontok sose 500-aznak), scrub-ALLOWLIST (új job-oszlop =
  tudatos döntés), link-integritás (halott belső href = piros build),
  stale-state E2E (user-váltás reload nélkül), foglalás-végrehajtás E2E.
  Elv: a tesztelő találjon ÚJ hibaosztályt, az automata őrizze az ismertet
- **Éles füstteszt-szkript**: `backend/scripts/eles-fustteszt.js` — a teljes
  kápé-flow (licit + foglalás + reopen + consent + kontakt-kapuzás) a prod
  API-n, jelölt tesztadatokkal, auto-takarítással. Deploy után:
  `cd backend && node scripts/eles-fustteszt.js`
- **Terheléses teszt (k6, 2026-08-08)**: `backend/scripts/load-teszt.js`
  (orchestrator: prod DB setup + `k6 run load-teszt.k6.js` + auto-takarítás;
  `brew install k6` kell). Négy szakasz szekvenciálisan: cold-start, publikus
  böngészés (4 rps, a limit ALATT — valós latencia), auth-GET (regisztrációs
  tokennel), rate-limit-próba (55 rps burst → a 429-védelmet igazolja).
  ⚠️ A backend globális limitje **300 kérés/perc/IP** (= 5 rps) — egy IP-ről
  a valós kapacitást csak a limit ALATT lehet mérni; a limit FÖLÖTT a 429 az
  ELVÁRT (nem hiba). ELSŐ ÉLES FUTÁS (2026-08-08): **0 db 5xx**, böngészés
  p50 ~243 ms / p95 ~578 ms, Neon cold-start ~1,6 mp, a rate-limit védelem
  igazoltan fékez. ⚠️ NE `| head`-eld a kimenetét (SIGPIPE megölheti a
  takarítás előtt) — fájlba írasd. Következő szint (később): terhelés
  EMELÉSE a Railway-plafonig (több gépről/IP-ről, hogy a 300/perc limitet
  megkerüld), és a valódi pénzes CIB-út mérése aktiváláskor
- **Plafon-teszt (k6, 2026-08-09)**: `backend/scripts/plafon-teszt.k6.js`
  (`k6 run`, nincs DB-setup). A `/health` SZÁNDÉKOSAN limiter-mentes (a
  limiter előtt), ezért rajta a Railway Hobby konténer NYERS HTTP/event-loop
  kapacitása mérhető terhelés-védelem nélkül. Rámpa 50→2000 req/s,
  szintenként külön mérve. ⚠️ A PROD konténert stresszeli — CSAK launch
  előtt (~0 user), éles forgalomban SOHA. EREDMÉNY (2026-08-09, egy
  IP-ről/gépről mérve): **~500 req/s-ig stabil** (p95 ~250 ms, ~0 hiba),
  **~590-690 req/s a kiszolgálható maximum**, 1000 req/s-től a kérések fele
  timeout (a konténer sorba állít, p95 ~9-10 mp). ⚠️ Ez a NYERS plafon —
  a DB-t érintő végpontok (Neon-kör minden kérésnél) ennek TÖREDÉKÉT bírják
  (~50-150 req/s becsült). A launch base-case (~300 fuvar/HÓ) ehhez képest
  elenyésző → a konténer bőven elég; az első valódi szűk keresztmetszet nem
  a throughput, hanem a Neon cold-start (~1,6 mp alvás után) és a
  rate limit. A ~500-600-as plafon részben KLIENS-oldali is lehet (egy
  gépről/lakossági netről) — tiszta szerver-plafonhoz több gépről kéne mérni
- **Ajánlói program ÉLES (2026-07-05, PR #58)** — egyoldalú referral: aki a
  linkjén (`?ref=KÓD`) hoz egy usert, ÉS az teljesíti az első fuvarját
  (feladóként az első díj kifizetése, VAGY sofőrként a fuvar lezárása), az
  ajánló **EGY INGYENES KAPCSOLATFELVÉTELT** kap. ⚠️ **A jutalom NEM
  pénzérték (user-döntés, 2026-08-09)**: MINDKÉT díjsávra érvényes (500 ÉS
  1.000 Ft), de **EGYSZER** váltható be — a kupon Ft-plafonja ezért NULL
  (a `max_fee_huf` mechanizmus megmarad általános eszköznek, a referral csak
  nem használja). Ok: pénzben megadva egy díjsáv-változás némán elvágná a
  jutalmat a felső sávban; a jutalom a SZOLGÁLTATÁS, nem egy összeg. Így a
  korábbi „500-at fizetsz, 1000-et érő kupont kapsz" arbitrázs-kérdés is
  tárgytalan: nem forintot adunk. Szöveg mindenhol „ingyenes
  kapcsolatfelvétel" (a régi „ingyen feladás kupon" kivezetve). Védelem: meghívott KYC='verified', userenként egyszer
  (atomi guard), havi 5 plafon ajánlónként. 046 migráció (users.referral_code
  UNIQUE + referred_by + referral_reward_granted_at; fee_vouchers.max_fee_huf),
  services/referral.js, GET /auth/referral, ReferralCard a profilon. A kupon a
  /pay-en Barion nélkül vált be (paid_via_voucher, 0 Ft). Végrehajtva: prod
  migráció + éles füstteszt zöld (`backend/scripts/referral-eles-fustteszt.js`).
  ⚠️ TANULSÁG: a félkész gamification voucher-rendszert (fee_vouchers) ez
  tette végre BEVÁLTHATÓVÁ (a useVoucherIfAvailable eddig sehol nem futott)
- **Beírható ajánlói kód (2026-07-05, PR #59)** — a link mellett a KÓD is
  megosztható: a regisztrációs űrlapon van egy szerkeszthető „Ajánlói kód"
  mező (a `?ref`-ből előtöltve, kézzel is beírható, nagybetűsít + szóköz-szűr),
  a ReferralCard pedig a kódot külön, kiemelt, másolható mezőben mutatja. A
  backend a kódot kis/nagybetűre érzéketlenül oldja fel (`resolveReferrerId`
  → `UPPER(referral_code)`), ismeretlen kódra a regisztráció sikeres, csak
  attribúció nélkül. Frontend-only, nincs migráció. Élesben tesztelve (kézzel
  gépelt, kisbetűs kód is helyesen attribuál)
- **Zöld pozicionálás + „megkeresed az üzemanyagod árát" (2026-07-06, PR #60)**
  — Tourmix-tanulság: a GoFuvar eleve zöldebb egy dedikált futárnál (a csomag
  meglévő úton utazik → nincs plusz jármű/károsanyag). `web/src/lib/green.ts`
  (konzervatív becslés: ~7 l/100km · 650 Ft/l · elkerült futár ~250 g CO₂/km,
  egy helyen hangolható) + GreenBadge komponens; a sofőr a fuvar-részleten és
  -listán látja a megspórolt CO₂-t + hogy a fuvardíj fedezi az üzemanyagot;
  landing zöld szekció (BP–Szeged példa). A számok TÁJÉKOZTATÓ becslések,
  jelölve. Frontend-only. Következő lépcső (még NEM kész): kézbesítés utáni
  „X kg CO₂-t spóroltál" + sofőr-dashboard halmozott statisztika (total_km
  már megvan)
- **Kattintható SEO landing-oldalak (2026-07-06, PR #62)** — adat-vezérelt
  sablon (`web/src/lib/landings.ts` + `LandingTemplate.tsx`): új oldal = új
  bejegyzés az adatba. 3 típus: útvonal (`app/fuvar/[utvonal]` dinamikus,
  SSG + generateMetadata: BP–Szeged/Debrecen/Pécs/Miskolc/Győr), célközönség
  (`/soforoknek`, `/webshopoknak`), használati eset (`/butorszallitas`,
  `/ikea-behozatal`). FAQ JSON-LD (rich result), footer „Népszerű oldalak"
  belső linkelés, sitemap bővítve, dark-mode tokenek. Útvonal-oldalon a
  green.ts-ből zöld/üzemanyag stat. Frontend-only. ⚠️ NINCS app — a
  szövegekben app-ígéret TILOS (a lane-alert „e-mailben szólunk", nem „app")
- **Jogosítvány ki + sofőri KRESZ-nyilatkozat (2026-07-07, PR #67)** — a
  személyi igazolvány (identity KYC) elég MINDENHEZ; sofőr-mód első
  használatakor DriverTermsGate nyilatkozat (047 migráció:
  `driver_terms_accepted_at`; `POST /auth/accept-driver-terms`). ÁSZF 3.2/3.4
  + adatkezelés átírva (KGFB is ki). Élesben smoke-tesztelve. Részletek az
  5. szakasz "Sofőri KYC" soránál
- **Kemény email-verify kapu (2026-07-08, PR #68)** — regisztráció/belépés
  után blokkoló "Erősítsd meg az email címed" overlay (EmailVerifyGate a
  globális layoutban; a soft EmailVerifyBanner törölve); a /email-megerositese
  céloldal sosem blokkolt; "Új link kérése" + "Már megerősítettem" + kijelentkezés.
  Frontend-oldali kapu (backend-kényszerítés opcionális hardening later).
  E2E helper email_verified=true-t seedel
- **QVIK fizetés-előkészítés MERGELVE (2026-07-09, PR #69)** — provider-
  absztrakció élesben, a `/payments/qvik/callback` a prodon fogadóképes
  (részletek + aktiválási checklist a 🟡 Várakozóban szakaszban)
- **„Licit" kivezetve a felületről (2026-07-11, PR #71)** — a szó árverést
  sugallt (legalacsonyabb ár nyer), pedig a feladó szabadon választ. Új
  terminológia: sofőrnek „Elérhető fuvarok" / „ajánlattétel" / „Ajánlataim";
  feladónak „fuvarfeladás" / „a sofőrök ajánlatot tesznek rá" / státusz:
  „Ajánlatokat vár". Web (src + app oldalak, hu.json), backend emailek +
  értesítések + hibaüzenetek + chatbot-tudás mind átírva. ⚠️ SZÖVEG-SZABÁLY:
  user felé „licit/licitálás" TILOS — mindig „ajánlat/ajánlattétel". NEM
  változott: kód-belső nevek (bids, API-útvonalak, `?tab=licitjeim` URL) és
  az ÁSZF. Bónusz: a gemini.js chatbot-tudás elavult állításai javítva
  (jogosítvány-követelmény, „Barion escrow", cégkivonat, Budapest-only)
- **Admin v2 — teljes értékű, füles panel (2026-07-17, PR #93)** — 6 fül
  (hash-alapú, a #kyc értesítés-link él): Áttekintés / KYC / Felhasználók
  (szerep+KYC inline szerkesztés, force-logout = token_version bump,
  törlés) / Fuvarok (keresés+státusz-átállítás+ajánlatok+chat+fotó-zárolás+
  törlés) / Járatok&foglalások / Viták (+"A felek chatje" gomb). Új backend:
  GET /admin/messages (csak admin!), POST /admin/users/:id/force-logout,
  GET /admin/jobs?search=. Veszélyes műveletek ConfirmDialog mögött.
  ⚠️ E2E-tanulság: a 06-os admin-spec a /admin#kyc fülre navigál
- **Chat + GPS retenció gépesítve (2026-07-17, PR #92)** — a photoRetention.js
  → `retention.js` (általános adat-retenció): chat-üzenetek a lezárás után
  6 hónappal törlődnek (zárolt ügyletnél 5 év — ugyanaz a hold flag, mint a
  fotóknál), GPS-pingek 7 nap után; napi `runDailyRetention` kör. Az
  adatkezelési 5. szakasz chat-sora a valós szabályra igazítva. Ezzel MINDEN
  adattípus életciklusa gépesített (KYC 30 nap / fotó 30 nap / chat 6 hó /
  GPS 7 nap / zárolt: 5 év) — a tájékoztató pontról pontra igaz
- **Fuvarfotó-retenció (2026-07-16, PR #91)** — pickup/dropoff fotók: 30 nap
  a lezárás után auto-törlés (napi job); vitás/admin-zárolt fuvarnál 5 év
  (`photo_retention_hold`, 049 migráció; vita-nyitás auto-zárol; admin:
  `PATCH /admin/photo-hold`). A KYC-fotó marad 30 nap (döntés: az 5 éves
  okmány-tárolás NAIH-kockázat — a csalásvédelmet a doc_number_hash fedi).
  Adatkezelési tájékoztató 5. szakasz frissítve. +5 backend teszt (a
  scrub-ALLOWLIST osztály-teszt menet közben el is fogta az új oszlop
  szivárgását — scrubJobForUser bővítve)
- **Szállító + Járat átnevezés (2026-07-16, PR #90)** — user-döntés: a
  „Sofőr" szerepnév USER FELÉ mindenhol **„Szállító"** (ok: jogosítvány-mentes
  modell — bringás/gyalogos futár nem „sofőr"; céges szállítók), a „fix áras
  útvonal" entitás pedig **„Járat"** (feladónak: „Induló járatok", szállítónak:
  „Járataim" / „Új járat hirdetése"; a „fix ár" tulajdonság-jelvény, nem név).
  108 fájlos bulk-sweep teljes magyar ragozási térképpel (sofőrrel→szállítóval
  stb.) + célzott járat-kör. A hero-szlogen is: **„Csomagod van? Szállítód is
  lesz."** (OG-kép újragenerálva). ⚠️ SZÖVEG-SZABÁLY (PR #71 mintájára):
  user felé „sofőr" és „fix áras útvonal" TILOS — „szállító" és „(induló)
  járat"; NEM változott: kód-belső nevek (driver/carrier/sofor URL-ek,
  /sofor/*, /soforoknek), az ÁSZF „Sofőr" definiált fogalma (híd-definícióval:
  „a Platform felületein: Szállító"), az adatkezelési tájékoztató, és a
  „Útvonal-figyelő" (az MÁS fogalom: földrajzi lane-alert). A /soforoknek
  metaTitle/description SEO-célból tartja a „sofőr/futár/fuvarozó" szavakat.
  SMS: „Szállító:" (+3 kar → név-cap 22→20, worst case 132 kar = 2 szegmens)
- **Egyszerűsített launch-árazás (2026-07-15, PR #87)** — user + ügyvezető
  döntése: ≤50e Ft fuvardíjig 500 Ft, felette 1.000 Ft (a 4 sávos struktúra
  hatályon kívül; cél a user-gyűjtés). Díjmotor + ÁSZF 4.1 + chatbot +
  landing-FAQ + referral-plafon (1.000) + tesztek + füstteszt mind szinkronban
- **Mód-alapú fejléc-nav (2026-07-15, PR #86)** — a fejléc középső linkjei
  az aktív módot követik (feladó: Fuvar feladása + Fix áras fuvarok; sofőr:
  Elérhető fuvarok + Útvonalaim; mobil dropdown is) — BUG-034 érdemi része
  ezzel lezárva, a teljes IA-redesign már nem aktuális
- **Privát KYC-bucket + kép magic-byte védelem (2026-07-13)** — a
  2026-07-11-i biztonsági audit 1-2. tétele lezárva: (1) a KYC-okmányfotók
  privát R2 bucketbe mennek (`gofuvar-kyc`, semmi publikus URL; presigned
  olvasás — admin UI változatlan, a szerver írja alá a linkeket; env:
  `R2_PRIVATE_BUCKET_NAME`; ha hiányzik → publikus bucketbe esik vissza
  kyc/ prefixszel + boot-warning); (2) MINDEN kép-feltöltésen (KYC, avatar,
  job- és booking-fotó) magic-byte ellenőrzés — a fájl TARTALMA dönt, nem
  a kliens MIME-ja (SVG/HTML-álca = stored-XSS kizárva; JPG/PNG/WebP/HEIC/
  AVIF/GIF fogadott, a sniffelt típus megy ContentType-ként a tárolóba)
- **SeeMe SMS ✅ ÉLES (2026-07-13)** — kulcs ROTÁLVA (a régi a git-históriában
  volt!) + `SEEME_API_KEY` a Railway-en; end-to-end bizonyítva a prodon
  (sms-e2e-fustteszt.js: teszt-fuvar → stub-fizetés → felvételi fotó →
  ékezetes SMS a user telefonján, 38 Ft = 2 UCS-2 szegmens). Út közben
  javítva a gateway-hívás (PR #83: az érvénytelen callback=0 miatt a SeeMe
  ELDOBTA a küldést; from→sender, válasz-parser query-string formára).
  ⚠️ KRITIKUS TANULSÁG: a SeeMe-nél az IP-allowlist NEM kikapcsolható —
  a Railway kimenő IP-je engedélyezve, de ha valaha ELFORDUL → code=13 →
  minden SMS némán kiesik → SENTRY-RIASZTÁS figyeli (sms.js
  reportSmsFailure); teendő ilyenkor: SeeMe admin → Gateway hozzáférés →
  az új IP hozzáadása (az IP a hibaüzenetben olvasható). Feladó-azonosító:
  SEEME_SENDER env-vel kapcsolható be, ha a "GoFuvar" sender jóváhagyott.
  Teszt-eszközök: scripts/sms-teszt.js (kulcs kézzel) + sms-e2e-fustteszt.js.
  💰 ÁR-TERV (user, 2026-07-13): a 38 Ft/fuvar (ékezetes, 2 szegmens, 19
  Ft/szegmens) EGYELŐRE marad, de volumen-felfutásnál (kb. 50-100e Ft/hó
  SMS-számlánál) BIZTOSAN váltunk a ≤70 karakteres ékezetes rövid
  változatra (1 szegmens = 19 Ft; a sofőr neve kimarad, csak kód +
  telefonszám + "Egyeztess vele!") — ~5 perces módosítás a photos.js
  két pickup-üzenetében
- **Mobil túlcsordulás-fix (2026-07-13, PR #80)** — a dekor-elemek (hero-glow
  inset -200px) túllógtak a viewporton → mobilon ki lehetett zoomolni, a
  tartalom a kijelző ~2/3-áig ért. Fix: `html, body { overflow-x: clip }`
  (CLIP, nem hidden — a sticky fejléc miatt!); osztály-teszt:
  e2e/11-mobil-overflow (4 publikus oldal, 390px, scrollWidth ≤ clientWidth).
  ⚠️ SZABÁLY: dekor-elem ne nyújtsa a dokumentumot — a clip véd, a teszt őrzi
- **Élő ajánlat-érkezés (2026-07-12, PR #78)** — a `bids:new` socket-eventet
  a web eddig NEM hallgatta (az új ajánlat csak reloadra jelent meg!); most a
  feladói fuvar-oldalon élőben érkezik, a landing-mockup animációjával + ÚJ
  jelvénnyel (10 mp után kifakul; `.bid-arrive`)
- **Design-polír 2. kör (2026-07-13, PR #79)** — (1) **VILÁGOS FEJLÉC**: a kék
  gradient → áttetsző surface light módban (dark marad sötét); logó-pár
  (színes/fehér lockup, display CSAK CSS-ből — inline display felülütné a
  témaváltást!); Belépés = primary CTA; (2) type-scale sweep: 67 off-scale
  fontSize → skála, 39 fájlban (codemod); (3) emoji→lucide zárókör a fő
  flow-kban (fuvarjaim 4 fül, útvonalaim, fuvar-részletek); (4)
  :focus-visible fókusz-gyűrű (WCAG 2.4.7). ⚠️ TANULSÁG: emoji-eltávolításnál
  az E2E szöveg-szelektorokat is nézd (04-ellenajanlat a 🔁-es címre várt).
  Állapot: EU-mércén ~8/10, magyar piacon 9,5 — a 8,5+ út: valódi fotók
  (launch után), komponensesítés, motion-mélység
- **Design-polír 1. kör (2026-07-12, PR #77)** — (1) EmptyState v2: márkázott
  üres állapotok 9 felületen (szaggatott kártya + lucide-ikon kör + A→B
  motívum + CTA; compact variáns a Fuvarjaim füleknek); (2) ListSkeleton a
  fő listákra (a Neon cold startot fedi); (3) type-scale tokenek + szabály
  (7. szakasz Design-szabályok); (4) OG-kép újragenerálva — ⚠️ a régin még
  "letéti fizetés" állt (escrow-kori, HAMIS a kápé-modellben); generátor:
  `web/scripts/generate-og-image.js`
- **Landing termék-mockup + emoji-sweep (2026-07-12, PR #76)** — (1) a hero
  alatt telefon-keretes, TOKEN-ALAPÚ élő termék-előnézet (ProductPreview.tsx):
  a feladott fuvarra érkező ajánlatok jelenete, a 3. (legjobb) ajánlat 1,4s
  késleltetéssel "érkezik" (gofuvar-offer-in; reduced-motion OK), lebegő
  átvételi kód-chip (560px alatt rejtve — ⚠️ inline display ellen `!important`
  kell a media query-ben); szándékosan NEM PNG (dark mode-dal vált, nem avul);
  (2) a PR #75-ös emoji→lucide szabály maradékai kigyomlálva (HomeHub
  mód-váltó, fejléc mód-chip, státusz-sorok, pill-emojik). Screenshot-
  ellenőrzés Playwrighttal (light/dark/mobil)
- **Apró UI-polír (2026-07-11, PR #75)** — (1) **locale-fix**: a böngésző-
  nyelv AUTO-detektálás kivéve az i18n-ből (fixen magyar; angol böngésző
  eddig kevert "Log in"+magyar oldalt kapott) — a külföldi launchnál kész
  fordítással kapcsolható vissza (komment jelzi a helyét az i18n.tsx-ben);
  (2) landing-kártyák + 404 + footer emoji → lucide SVG (⚠️ SZABÁLY: UI-
  ikonként emoji TILOS, mindig lucide — emoji csak prózában/banner-ben OK);
  (3) hero "Sofőröd is lesz." + stat "500 Ft-tól" nowrap (sortörés-fix)
- **Új szlogen (2026-07-07, PR #66)**: "Ha fuvar kell, akkor GoFuvar." —
  web footer + minden email fejléce + tracking-oldal (a "Bizalom. Fotó. Kód."
  és a bennragadt "Letét." lecserélve)
- **Use-case landing bővítés (2026-07-06, PR #63)** — 4 új használati eset
  oldal az adatból: `/koltoztetes`, `/nagygep-szallitas`,
  `/marketplace-elhozas`, `/autoszallitas`. Az autószállítás TRÉLERES +
  kiemelt engedély-figyelmeztetéssel (a GoFuvar közvetítő, a feladó felel a
  szállító engedélyének ellenőrzéséért — ÁSZF-konzisztens). Útvonal-oldalból
  többet NEM gyártunk (user döntése), a fókusz a use-case-eken.
  ⚠️ ÁRAZÁS-MEGFOGALMAZÁS: a landingeken TILOS a „te szabod az árat" — a
  licites modellben a SOFŐR ad árajánlatot, a feladó elfogadja/ellenajánlatot
  tesz („A sofőr ajánl, te döntesz"). Az okos árazó csak ajánlott sávot ad.
- **Fuvarozók-oldal + landing-szöveg finomítás (2026-07-06, PR #64)** —
  `/fuvarozoknak`: dedikált toborzó-oldal fuvarozó cégeknek / egyéni
  vállalkozóknak / hivatásos sofőröknek (a profi kínálati oldal, amire a jó
  feladói élmény épül). Fő üzenet: a fuvardíj 100%-a a tiéd készpénzben,
  NINCS jutalék a díjadból; üres visszaút megtöltése; rendszeres fuvar;
  céges/EV profil; reputáció. A FŐOLDAL is kapott egy fuvarozó-toborzó sávot
  (link a /fuvarozoknak-ra). ⚠️ KÉT SZÖVEG-SZABÁLY (visszatérő hibák): (1)
  TILOS „gyakran olcsóbb, mint egy dedikált cég/futár" — helyette verseny-
  alapú „a sofőrök versenye miatt gyakran kedvező áron"; (2) TILOS „a sofőr
  ennyi Ft üzemanyagot keres a fuvaron" kvantifikált stat (az üzemanyag
  költség, nem kereset) — a zöld/CO₂ üzenet marad, a /soforoknek kvalitatív
  „megkeresed az üzemanyagod árát" toborzó-üzenete OK
- **Sofőri (szint-alapú) kupon KIKAPCSOLVA (2026-07-05, PR #58)** — a sofőr
  100% kápét kap, sosem fizet kapcsolatfelvételi díjat, így egy díj-elengedő
  kupon neki haszontalan. A `recalcLevel` level_up_bonus + `grantMonthlyVouchers`
  kivéve (dormant, LEVELS[].monthlyVouchers config marad). Kupont mostantól
  CSAK az ajánlói program oszt, mindig a feladó oldalán
- **Tesztelői hibajavítások (2026-07-04, PR #52-53)** — BUG-041: a fix
  áras foglalás lezárható (booking pickup/dropoff + kód, 045-ös migráció,
  CarrierTripPanel entity='booking', ReviewBox a foglalásokra); süti-banner
  GDPR-linkje 404 volt (/adatvedelem→/adatkezeles); KYC-kártya a valós
  státuszhoz kötve; mező-validációk (BUG-011); stale-UI kör eseményvezérelt
  frissítéssel — BUG-015: az EmailVerifyBanner user-váltásnál nulláz (idegen
  email többé nem látszik)
- Admin CRUD panel
- PWA telepíthető
- Coverage Európa
- AI chatbot frissített tudás (PWA-magyarázat + anti-hallucinációs tiltás)
- Auto-logout, dual delivery code, recipient SMS, és sok más
- **Ellenajánlat (Vinted-stílusú alku)** — a feladó és a sofőr oda-vissza
  ellenajánlatot küldhet a liciten (realtime + escrow-versenyvédelem)
- **"Hozasd el"** — IKEA/OBI/Praktiker/Jófogás terméklink → OG-előnézet
  (cím + kép) → fuvar-előtöltés; a **termékkép a sofőrig is eljut** (host-
  engedélylistával validált kép-URL)
- **Sikertelen kézbesítés: visszaszállítási nyilatkozat** — a sofőr a licitnél
  kötelezően nyilatkozik (benne van / +díj / nem), a feladó jelvényként látja
- **Admin: élő jelenlét dashboard** — kik vannak ÉPPEN az oldalon (aktív
  Socket.IO kapcsolatokból, 5 mp-enként frissül)
- **Admin: felhasználói aktivitás-napló** — utolsó belépés, belépés-szám,
  utoljára aktív, becsült összes aktív idő (socket-élettartamból); kereshető
- **Admin: KYC kézi jóváhagyási felület** — függő dokumentumok kép-előnézettel,
  ✅ jóváhagyás / ❌ elutasítás (indokkal, amit a user értesítésben megkap);
  a KYC-értesítések a `/admin#kyc` szekcióra visznek
- **Okos árazás** a feladásban (ajánlott ársáv, ~90 Ft/km kalibráció)
- **Sofőr lane-alert** (email + in-app értesítés, NEM SMS — spórolás)
- **Teljes automata tesztvédelem (58 teszt, 2026-07-02)** — 27 web unit +
  23 backend üzleti szabály + 8 Playwright E2E, mind CI-ben minden PR-en
  (részletek: 7. szakasz 8. pont). Közben javítva: fizetetlen fuvaron nem
  indítható munka (paid_at guard) + lemondáskor az escrow-sor refunded-re
  vált (eddig held-ben ragadt)
- **GPS "Hamarosan" kommunikáció + dark mode fixek (2026-07-03, PR #48-49)**
  — az élő GPS sehol nem launch-ígéret többé (badge + jövő idő); fekete
  térkép-markerek javítva. ⚠️ TANULSÁG: a Google Maps API (fillColor/
  strokeColor) és az InfoWindow tartalma NEM ért CSS-változót — ott
  mindig literál hex kell, színtoken-sweep ne érintse!
- **SEO-alapok + design-identitás (2026-07-03, PR #46-47)** — og:image
  (FB-megosztáshoz), JSON-LD, meta descriptionök; gomb-emoji purge;
  márka-aláírás: A→B útvonal-motívum (hero + "Hogyan működik" fonál +
  OG-kép) + Bricolage Grotesque display-tipográfia a címsorokon
  (törzsszöveg marad Inter)
- **Polír-csomag (2026-07-02, PR #44)** — 187 hex → design-token (dark
  mode konzisztens), 17 oldalankénti title + favicon-készlet + sitemap,
  a11y-kör (toast aria-live, htmlFor/autocomplete a fő űrlapokon),
  HomeHub emoji → lucide SVG. **Nyelvváltó ELREJTVE** a fejlécből (a
  fordítás ~3/31 oldal volt) — az i18n-infra él, külföldi launchnál
  kész fordítással tér vissza

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
8. Vercel + Railway automatikusan deployol; **739 teszt fut CI-ben minden
   PR-en és main-pushon** (~3 perc összesen):
   - **87 web unit** (Vitest, `web-tests.yml`) — benne a
     **link-integritás osztály-teszt**: minden statikus belső href-hez
     léteznie kell App Router oldalnak (a /adatvedelem-404 osztálya ellen)
   - **556 backend üzleti szabály** (Vitest + supertest + embedded-postgres,
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
   - **96 böngészős E2E** (Playwright, `e2e-tests.yml` — teljes stack:
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

- **Build fail Vercelen** → SWC parse error, általában láthatatlan karakter
  egy file-ban. Megoldás: a file-t Write-tal újraírni tisztán.
- **Railway nem deployol** → ellenőrizni Settings → Source → Branch (= `main`?)
  + Auto deploys = enabled
- **Vercel "Preview only"** → Settings → Git → Production Branch = `main`
- **DB-eredetű "Szerverhiba" (500)** → a prod DB a **Neon** (nem Supabase!).
  Nézd a Neon compute-kvótát/csomagot a console.neon.tech-en. Teszt: a
  `/tracking/:token` végpont 500-at ad ha a DB döglött, 404-et ha él.
- **PG SSL warning a Railway logokban** → nem hiba, csak figyelmeztetés
- **SMS nem megy ki** → Railway log, keresés: `sms`. `[sms] SeeMe elutasítás
  code=13` = a Railway kimenő IP elfordult → SeeMe admin → Gateway
  hozzáférés → új IP engedélyezése (az IP a hibaüzenetben); erre Sentry-
  riasztás is jön. code=7 = SeeMe egyenleg elfogyott (feltöltés).
  Gyors kézi teszt: `SEEME_API_KEY=... node scripts/sms-teszt.js +36...`
- **Robotok / noindex** → src `web/public/robots.txt` jelenleg `Disallow: /` — élesedéskor `Allow: /`-ra

---

## 10. Új session quick-start (ha ide ránézel és nem tudod mit csinálj)

1. **Üdvözöld a user-t magyarul**, röviden
2. **Kérdezd meg**: van-e konkrét feladat, vagy státusz-update kell
3. Ha **QVIK-helyzet**: kérdezd meg, megjött-e a fizetés-elfogadási
   jogosultság (a Barion 2026-07-11 óta VÉGLEG elvetve — ne hozd fel)
3/b. Ha **launch-előkészítés** zajlik (QVIK megjött / launch-dátum szóba
   kerül): **KÖTELEZŐEN hozd fel a 6. szakasz 🔴 Launch-kapu adatvédelmi/
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
