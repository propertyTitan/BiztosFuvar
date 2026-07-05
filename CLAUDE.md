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
  feladótól elfogadáskor (Barion, sima webshop-fizetés — NEM kell escrow!);
  kontakt-felfedés csak a díj után; az escrow-kód dormant (később
  "Védett fizetés" opció lehet)
- 6 jegyű átvételi kód + QR kód
- 5 db SMS a címzettnek (felvétel, 5km, 300m, kézbesítés, feladónak is visszaigazolás)
- Élő GPS-tracking (background, dinamikus 60s→15s frekvencia) — ⚠️ a
  backend kész, de élő pozíció CSAK a mobilapppal lesz (Phase 6); a
  web-first launchon MINDENHOL "Hamarosan"-ként kommunikáljuk (2026-07-03
  döntés, PR #48: landing badge, chatbot-tudás, tracking-oldal szövege)
- Privát file storage (R2 + audit log)
- Email verifikáció + password reset
- Sentry hibajelzés (kulcsra vár)
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
 (eu-central-1)     (privát bucket)       Barion (fizetés, STUB)
                                          SeeMe.hu (SMS, STUB)
                                          Resend (email, STUB)
                                          Sentry (hibafigyelés, STUB)
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
- ⚠️ A régi Supabase projekt (`frlxrbdfcuojzhafelyn`) **üres és nem használt**
  (csak `auth`+`vault` séma). Ha DB-eredetű "Szerverhiba" (500) jön, a **Neont**
  kell nézni/upgradelni — NEM a Supabase-t (kvóta: console.neon.tech)

### R2 bucket
- `gofuvar-uploads` a Cloudflare account `4ffc8483390d0d1da83fab3ba05a4172`-en
- **Még publikus mode-ban** (privát R2 + audit log refactor függőben — Phase 6)

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
| Üzleti modell | **KÉSZPÉNZES (2026-07-03, user döntése, felelősséget vállalta)**: a fuvardíj kápéban megy a sofőrnek (100%); a platform bevétele a kapcsolatfelvételi díj. A korábbi 10%+400 escrow-modell hatályon kívül — a kód dormant, később "Védett fizetés" opció lehet |
| Kapcsolatfelvételi díj | **Sávos, bruttó, BEVEZETŐ ár** (mindenhol így kommunikálva!): ≤20e → **500 Ft** / ≤50e → **1.490 Ft** / ≤100e → **2.490 Ft** / felette → **3.990 Ft**. NEM visszatérítendő (45/2014. 29.§(1)a consent-checkbox a fizetésnél); a fuvarra szól: sofőr-meghiúsulásnál díjmentes újraválasztás, másik fuvarra NEM vihető át. Emelési trigger: stabil ~300+ fuvar/hó |
| Kontakt-kapuzás | Telefonszám/email CSAK a díj megfizetése után látszik (ez a kikerülés-védelem lényege; chat contactGuard fizetés előtt szűr) |
| Lemondási díj | **NINCS** — lemondás ingyenes, de a befizetett díj nem jár vissza |
| Kárfelelősség | NINCS platform-szabta kárplafon — a platform nem felel, a Feladó és a Sofőr a Ptk. szerint rendezi egymás közt (ÁSZF 5.2) |
| Coverage | **Európa-szintű** (lat 34-71, lng -10..32) — magyar fő piac, EU mellesleg |
| Csomag tilalom | NINCS hardcoded lista — a Feladó felelős hogy ellenőrizze a sofőr engedélyét speciális áruhoz (élő állat, gyógyszer, stb.) |
| Sofőri biztosítás | KGFB nyilatkozaton (kötelező magyar jog szerint); Casco/CMR NEM kötelező és NEM ellenőrizzük |
| KYC retention | 5 év a fiók-törlés után (ÁSZF), de a fotó 30 nap után törlődik (privacy-by-default — még nem aktív, Phase 6) |
| GPS retention | 7 nap nyers, utána anonimizálva |
| Chat retention | 6 hónap a fuvar lezárása után |
| App store | **NINCS** még — PWA telepítéssel megy |
| Marketing-stratégia | Top 5 magyar útvonal (Pest-X) + intercity fókusz |
| Customer-base | Egyetemista bútor-átvitel, marketplace eladók, IKEA-vásárlók (3 perszóna) |

---

## 6. Mit készítünk a launchhoz

### ✅ Kész (élesedett)
- Web app teljesen (gofuvar.hu)
- Backend Railway-en, always-on
- DB migrációk
- ÁSZF + GDPR Tiszta Hód adatokkal + EU-kiegészítés
- Email verifikáció + password reset (kód, STUB)
- Sentry SDK (DSN-re vár)
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

### 🟡 Várakozóban
- **Barion szerződés** — ⚠️ a készpénzes modellel (2026-07-03) a Bridge/escrow
  **már NEM launch-blokker**: a kapcsolatfelvételi díjhoz SIMA Barion
  webshop-szerződés elég (napok, nem hetek). A Bridge-kérelem futhat tovább a
  háttérben a későbbi "Védett fizetés" opcióhoz
- **D-U-N-S szám** — Apple-enrollment-flow indítása apukán át (Apple Developer fiók)
- **Resend.com** — fiók + DNS verify + API key Railway env-be
- **SeeMe.hu** — API kulcs Railway env-be
- **Sentry.io** — DSN Railway + Vercel env-be
- **Számlázz.hu / Billingo** — előfizetés + API kulcs (nem launch-blokker)
- **Tesztelői visszakérdezések** (a 2. körből elhalasztva): BUG-005 — hol
  látott fejléc-avatart (a fejlécben monogram van); BUG-033 — melyik 4
  különböző feliratú menüpont visz ugyanoda. Termék-/design-döntést vár:
  BUG-019 forgatás-kerülés (OCR-alapú duplikátum-szűrés korlátja),
  BUG-034 teljes mód-alapú navigáció (IA-redesign)

### 🟠 Phase 6 (későbbre)
- Privát R2 file storage + audit log (progressive_kyc-vel kompatibilisre — már van branch, csak nem mergelve)
- Mobile native app (App Store + Play Store)
- Top 5 útvonal-landing oldalak (`gofuvar.hu/pest-szeged` stb.)
- Sofőröknek külön landing
- Service Worker offline-támogatás (a sofőr elfogadott fuvarjait offline lássa)
- Custom domain név pointing API-ra (api.gofuvar.hu = Railway)
- Cégkivonat-igénylés Apple-D-U-N-S-hez
- Magyar ügyvéd-review az AI-által írt EU-kiegészítésekre

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
8. Vercel + Railway automatikusan deployol; **85 teszt fut CI-ben minden
   PR-en és main-pushon** (~3 perc összesen):
   - **28 web unit** (Vitest, `web-tests.yml`) — benne a
     **link-integritás osztály-teszt**: minden statikus belső href-hez
     léteznie kell App Router oldalnak (a /adatvedelem-404 osztálya ellen)
   - **44 backend üzleti szabály** (Vitest + supertest + embedded-postgres,
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
   - **13 böngészős E2E** (Playwright, `e2e-tests.yml` — teljes stack:
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
- **Robotok / noindex** → src `web/public/robots.txt` jelenleg `Disallow: /` — élesedéskor `Allow: /`-ra

---

## 10. Új session quick-start (ha ide ránézel és nem tudod mit csinálj)

1. **Üdvözöld a user-t magyarul**, röviden
2. **Kérdezd meg**: van-e konkrét feladat, vagy státusz-update kell
3. Ha **Barion-helyzet**: kérdezd meg milyen választ kapott
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
- A **Barion szerződés** a fő külső függőség — ha minden megvan, már lehet launch

---

## 12. Apa & család kontextus

- Apa (Jovány Gyula) tulajdonos + ügyvezető — **csak külső dokumentumokra kell**
  (Apple Developer signing, Barion szerződés, banki ügyek)
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
