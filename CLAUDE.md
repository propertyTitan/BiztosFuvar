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
- Escrow + split payment (Barion)
- 6 jegyű átvételi kód + QR kód
- 5 db SMS a címzettnek (felvétel, 5km, 300m, kézbesítés, feladónak is visszaigazolás)
- Élő GPS-tracking (background, dinamikus 60s→15s frekvencia)
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
| Platform díj | **10% + 400 Ft fix** (lawyer approved) |
| Lemondási díj | 8.000 Ft alatt **400 Ft fix** / felett **5%** (lawyer approved) |
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
- Tracking, fotó, escrow logic (Barion STUB)
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

### 🟡 Várakozóban
- **Barion Bridge szerződés** — kérelem elküldve, partners@barion.com várjuk
  (2-4 hét tipikus átfutás, ez a fő launch-blokker)
- **D-U-N-S szám** — Apple-enrollment-flow indítása apukán át (Apple Developer fiók)
- **Resend.com** — fiók + DNS verify + API key Railway env-be
- **SeeMe.hu** — API kulcs Railway env-be
- **Sentry.io** — DSN Railway + Vercel env-be
- **Számlázz.hu / Billingo** — előfizetés + API kulcs (nem launch-blokker)

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
6. **PR ha elérhető** (mcp__github__create_pull_request / merge). ⚠️ Ha nincs
   `gh` CLI ÉS nincs GitHub MCP (mint a 2026-06/07 sessionökben), akkor
   **közvetlen `git merge --no-ff` main-re + push** a bevált fallback — a
   Vercel/Railway így is auto-deployol. (`gh` telepítés: `brew install gh` +
   `gh auth login`, ha PR-workflow-t akarsz.)
7. Migráció ha kell: `cd backend && npm run db:migrate` (a prod Neon ellen)
8. Vercel + Railway automatikusan deployol
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
