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
| Kapcsolatfelvételi díj | **Sávos, bruttó, BEVEZETŐ ár** (mindenhol így kommunikálva!): ≤20e → **500 Ft** / ≤50e → **1.490 Ft** / ≤100e → **2.490 Ft** / felette → **3.990 Ft**. NEM visszatérítendő (45/2014. 29.§(1)a consent-checkbox a fizetésnél); a fuvarra szól: sofőr-meghiúsulásnál díjmentes újraválasztás, másik fuvarra NEM vihető át. **2026-ban a bevezető sávos ár marad; díjemelés legkorábban 2027-től** (user döntése, 2026-07-06; korábbi emelési jelzés: stabil ~300+ fuvar/hó). **2026-07-11 fontolgatás (NEM döntés): feladói B2B-előfizetés** — 3.990 Ft/hó, mellette minden feladás fix 400 Ft kapcsolatfelvételi díj (sávtól függetlenül); break-even a feladónak: ~2-4 közepes/nagy fuvar/hó → önszelektáló, a visszatérő céges feladót fogja meg. Feltételek ha egyszer élesedik: fair-use plafon (viszonteladó-arbitrázs ellen), céges/KYB-fiókhoz kötés javasolt, recurring fizetés kell; legkorábban 2027, a team/multi-user + sofőr-előfizetéssel egy polcon ("GoFuvar Business") |
| Sofőr díjmentessége | **2026-ban a sofőr BIZTOSAN díjmentes** (user döntése, 2026-07-06): a fuvardíj 100% kápé, a platform a sofőrtől semmit nem szed. A megfontolt **sofőr-előfizetés** (990 Ft/hó, ELSŐ HÓNAP INGYEN, token-alapú auto-megújítás) NEM 2026-os — legkorábban **2027**, és CSAK ha (a) a Barion recurring/token fizetés él, (b) van sűrű fuvarforgalom (a sofőr egy nap alatt visszakeresi). **2026-07-11 user-pontosítás:** ársáv **1.000–2.000 Ft/hó**, trigger: **~500–1000 AKTÍV sofőr** (javasolt mérce: aktív = havi ≥1 teljesített fuvar — a fuvarsűrűség a valódi feltétel, nem a regisztrált darabszám); még csak fontolgatás, nem döntés. Jogi: auto-megújítás fogyasztóvédelmi tájékoztatás + könnyű lemondás + terhelés előtti emlékeztető. Kártyát nem a regisztrációnál, hanem az ingyen hónap vége felé / első fuvarnál javasolt kérni (kínálat-megtartás) |
| Kontakt-kapuzás | Telefonszám/email CSAK a díj megfizetése után látszik (ez a kikerülés-védelem lényege; chat contactGuard fizetés előtt szűr) |
| Lemondási díj | **NINCS** — lemondás ingyenes, de a befizetett díj nem jár vissza |
| Kárfelelősség | NINCS platform-szabta kárplafon — a platform nem felel, a Feladó és a Sofőr a Ptk. szerint rendezi egymás közt (ÁSZF 5.2) |
| Coverage | **Európa-szintű** (lat 34-71, lng -10..32) — magyar fő piac, EU mellesleg |
| Csomag tilalom | NINCS hardcoded lista — a Feladó felelős hogy ellenőrizze a sofőr engedélyét speciális áruhoz (élő állat, gyógyszer, stb.) |
| Sofőri KYC / biztosítás | **Jogosítvány NEM kell (2026-07-07)** — a személyi igazolvány (identity KYC) elég MINDENHEZ (feladó+sofőr); így a nem-motoros futárok (bringa, gyalog, tömegközlekedés) is mehetnek. Sofőri egyszeri **nyilatkozat** (jogszabályok + KRESZ betartása) a sofőr-mód első használatakor (`driver_terms_accepted_at`, `POST /auth/accept-driver-terms`, DriverTermsGate). Külön **KGFB-nyilatkozat NINCS** (a KGFB magyar jog szerint úgyis kötelező minden gépjárműre; az ÁSZF 3.4 általános „minden jogszabályt betart" kikötése fedi). Casco/CMR NEM kötelező. ⚠️ marketingben TILOS a „jogosítvány nem kell" (ne hívjuk fel rá a figyelmet) — csak pozitív „bármivel mehet". ÁSZF 3.2/3.4 + adatkezelés átírva. Jogosítvány-plumbing dormant. Kor: ÁSZF 3.1 = 18+ (16+ = ügyvéd-kérdés) |
| Céges fiók (KYB) | **Adószám + cégnév KÖTELEZŐ (formátum-ellenőrzéssel), de NINCS dokumentum/fotó/admin-jóváhagyás (2026-07-05, PR #57)** — a régi company_verification kapu kivéve, a plumbing dormant. A természetes személyt az identity KYC védi. Jövőbeli olcsó win: NAV adószám-lekérdezés + "Ellenőrzött cég" jelvény (Option B), majd reputációs "Kiemelt fuvarozó" (uShip/Shiply-modell). Céges perszónák: költöztető cég, bútorbolt, fuvarozó |
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
- **Ajánlói program ÉLES (2026-07-05, PR #58)** — egyoldalú referral: aki a
  linkjén (`?ref=KÓD`) hoz egy usert, ÉS az teljesíti az első fuvarját
  (feladóként az első díj kifizetése, VAGY sofőrként a fuvar lezárása), az
  ajánló ingyen-feladás kupont kap (kapcsolatfelvételi díj elengedve a 2490
  Ft-os plafonig). Védelem: meghívott KYC='verified', userenként egyszer
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
  Teszt-eszközök: scripts/sms-teszt.js (kulcs kézzel) + sms-e2e-fustteszt.js
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

### 🟡 Várakozóban
- **FIZETÉS: QVIK-re váltás (2026-07-08 döntés)** — a Barion drága; a
  kapcsolatfelvételi díjat **QVIK-kel** (magyar azonnali fizetés, QR /
  request-to-pay, ~0,4–0,8% díj, azonnali jóváírás, nincs chargeback) szedjük.
  **ELŐKÉSZÍTVE + MERGELVE (PR #69, 2026-07-09; a qvik-callback a prodon él):**
  `services/paymentProvider.js` absztrakció
  (a `PAYMENT_PROVIDER` env váltja: barion|qvik; a jobs/bids ezen megy),
  `services/qvik.js` stub + dokumentált TODO-k, `/payments/qvik/callback`
  route-skeleton. **AKTIVÁLÁS amikor megjön a jogosultság:** (1) töltsd ki a
  `qvik.js` `startFeePayment`+`getPaymentState`-jét a PSP API-jával; (2) állítsd
  be `PAYMENT_PROVIDER=qvik` + `QVIK_API_KEY`/`QVIK_MERCHANT_ID`/`QVIK_BASE_URL`
  a Railway-en; (3) kösd be a qvik-callback feldolgozását (a Barion-callback
  27–291. sorát javasolt közös `confirmFeePayment` helperbe kiszervezni).
  **2026-07-11 user-döntés: a Barion VÉGLEG ELVETVE** ("meguntam a velük lévő
  harcot") — a Barion-kód csak dormant maradvány, NEM élesítendő; Barion-
  szerződés és Barion Pixel okafogyott. Launch-fizetés = QVIK. ⚠️ Következmény:
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
- **D-U-N-S szám** — Apple-enrollment-flow indítása apukán át (Apple Developer fiók)
- **Gmail "Küldés másként" megerősítése** — a user állítja be, hogy a
  gmailből info@gofuvar.hu néven válaszolhasson (SMTP: smtp.resend.com,
  port 465, user: resend, jelszó: a Resend API-kulcs + "válasz ugyanarról
  a címről" pipa). A bejövő irány már ÉLES (lásd ✅ lista)
- ~~SeeMe.hu — API kulcs Railway env-be~~ → ✅ ÉLES (2026-07-13, lásd a ✅ listát)
- **Számlázz.hu / Billingo** — előfizetés + API kulcs (nem launch-blokker)
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
