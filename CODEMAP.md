# CODEMAP.md — GoFuvar kódbázis-térkép

> **Cél:** gyors orientáció. Mi hol van, mi mire épül, hol kezdj keresni.
> Párja a `CLAUDE.md` (ki a user, üzleti döntések, workflow) — ez itt a
> **technikai** térkép. Ha új feature jön: előbb ezt nézd át, hogy tudd hova illik.
>
> Frissítési szabály: ha új route / service / komponens / migráció születik,
> írd be ide is, és commitold:
> ```
> docs(CODEMAP.md): <mi változott>
> ```

---

## 0. Nagy kép (data flow)

```
  Web (Next.js 14, Vercel)            Mobile (Expo RN — NEM élesedett)
  gofuvar.hu                          mobile/  (phase 2, App Store után)
        │                                   │
        │  web/src/api.ts (fetch + JWT)     │
        └───────────────┬───────────────────┘
                        ▼
            Backend (Node/Express, Railway)
            api.gofuvar.hu   ← backend/src/index.js a belépőpont
                        │
        ┌───────────────┼───────────────────────────────┐
        ▼               ▼                                ▼
   Neon Postgres    Cloudflare R2                Külső szolgáltatások
   (backend/db/)    (services/storage.js)        (mind STUB amíg nincs kulcs):
                                                  Barion  → services/barion.js
                                                  Email   → services/email.js (Resend)
                                                  SMS     → services/sms.js (SeeMe.hu)
                                                  AI      → services/gemini.js (Gemini, ÉL)
                                                  Maps    → web/src/lib/maps.ts (Google, ÉL)
```

**Fontos elv:** a frontend SOHA nem beszél közvetlenül DB-vel / R2-vel / külső
API-val. Minden a backenden megy át. A Neon connection string, R2 kulcsok,
JWT secret, Gemini kulcs = csak backend env (`backend/.env`, gitignore-olt).

---

## 1. Backend — `backend/src/`

Belépőpont: **`index.js`**. Itt történik a route-mounting (lásd lentebb),
a CORS, a JSON body limit (2mb), a global rate limit és a hibakezelő.

Top-level fájlok:
| Fájl | Mit csinál |
|---|---|
| `index.js` | Express app, route mount, middleware-sor, error handler |
| `db.js` | Neon Postgres pool (`db.query(...)`), service-role kapcsolat |
| `constants.js` | Platform-díj, lemondási díj, plafonok — az üzleti számok (CLAUDE.md #5) |
| `realtime.js` | Socket.io (élő tracking, chat push) |

### 1.1 Route-mounting (`index.js`)

**Csak két route kap saját prefixet, a többi `/`-re megy:**
- `/auth`  → `routes/auth.js`
- `/jobs`  → `routes/jobs.js`
- minden más → `/` (bids, photos, tracking, reviews, payments, carrierRoutes,
  notifications, ai, disputes, messages, backhaul, sos, towing, driverStats,
  admin, jobQuestions, calculator, publicTracking)

> Ezért ha egy endpointot keresel és nem találod a prefix alapján: a legtöbb
> route a `/`-en ül, a konkrét utat a route-fájlban kell megnézni
> (`router.get('/valami', ...)`).

### 1.2 Routes — `backend/src/routes/` (20 fájl)

| Fájl | Felelős terület |
|---|---|
| `auth.js` | regisztráció, login (email **LOWER**-rel, case-insensitive), email-verifikáció, jelszó-reset |
| `jobs.js` | fuvar CRUD, listázás, `as=assigned` szűrő (sofőri fuvaraim) |
| `bids.js` | licitálás, licit elfogadása (atomic first-wins) |
| `photos.js` | felvételi/kézbesítési fotók (R2-re tölt); kézbesítéskor NINCS pénzmozgás (kápé-modell) |
| `tracking.js` | élő GPS pozíció-küldés/lekérés (auth-os) |
| `publicTracking.js` | nyilvános követés token alapján (no auth) |
| `reviews.js` | értékelések |
| `payments.js` | kapcsolatfelvételi díj Barion-webhookja + admin fizetési napló (STUB). ⚠️ Kápé-modell (2026-07-03): a fuvardíj készpénzben megy, a platform csak a díjat szedi; az escrow_transactions tábla a DÍJ-fizetést könyveli (amount=díj, carrier_share=0) |
| `carrierRoutes.js` | sofőri fix útvonalak + foglalás rájuk |
| `backhaul.js` | visszafuvar-matching |
| `bids` / `disputes.js` | vitarendezés |
| `messages.js` | chat (fuvaronként) |
| `sos.js` | vész/SOS jelzés |
| `calculator.js` | ár-kalkulátor (nyilvános) |
| `towing.js` | "mentős" roadside-assistance flow — **nincs jutalék wire-olva** (lásd memory) |
| `driverStats.js` | sofőr statisztikák, gamifikáció |
| `admin.js` | admin CRUD panel (role === 'admin') |
| `jobQuestions.js` | fuvar alatti kérdés-válasz |
| `favorites.js` | kedvencek |
| `ai.js` | `/ai/chat` (Gemini chatbot), KYC dokumentum-feldolgozás |

### 1.3 Services — `backend/src/services/` (16 fájl)

Üzleti logika, külső integrációk. A STUB-ok kulcs nélkül no-op / fake választ adnak.

| Fájl | Mit | Állapot |
|---|---|---|
| `barion.js` | díj-fizetés (`startFeePayment`); a régi escrow/split fn-ek dormant | **STUB** (`isStub()` true ha nincs `BARION_POS_KEY`) |
| `connectionFee.js` | kapcsolatfelvételi díjsávok (ÁSZF 4.1) — az üzleti számok itt | ÉL |
| `email.js` | tranzakciós email | **STUB** (Resend kulcsra vár) |
| `sms.js` | 5 db SMS flow | **STUB** (SeeMe.hu kulcs "elvileg megvan") |
| `gemini.js` | AI chat + KYC OCR/kor-ellenőrzés | **ÉL** |
| `storage.js` | R2 fel-/letöltés, publicUrl | ÉL (még publikus bucket) |
| `kyc.js` | KYC üzleti logika (típusok, jóváhagyás) | ÉL |
| `notifications.js` | in-app értesítések | ÉL |
| `push.js` | push token kezelés | ÉL |
| `invoicing.js` | számlázás | részleges (Számlázz.hu nincs bekötve) |
| `vat.js` / `exchange.js` | ÁFA, árfolyam | ÉL |
| `trustScore.js` / `gamification.js` | bizalmi pont, jelvények | ÉL |
| `instantJobs.js` | instant ("UberFuvar") matching | ÉL |
| `backhaul.js` / `routeAlong.js` | visszafuvar + útba-eső matching | ÉL |

### 1.4 Middleware — `backend/src/middleware/`

| Fájl | Mit |
|---|---|
| `auth.js` | JWT-ellenőrzés → `req.user = { sub, role, email }`. Admin = `role === 'admin'` |
| `rateLimit.js` | global + per-route rate limit |
| `validateParams.js` | input-validáció |

### 1.5 Utils — `backend/src/utils/`

| Fájl | Mit |
|---|---|
| `jobAccess.js` | **`getJobParty(jobId, user)`** — ki ez a user ehhez a fuvarhoz (feladó/sofőr/admin/idegen). Authz-döntések központi helye |
| `coverage.js` | Európa-coverage ellenőrzés (lat 34-71, lng -10..32) |
| `geo.js` | távolság, koordináta-számítás |
| `contactGuard.js` | kcontakt-adat szivárgás szűrése chatben |
| `qr.js` | QR-kód generálás (átvételi kód) |

### 1.6 Adatbázis — `backend/db/`

- `schema.sql` — teljes séma snapshot
- `migrations/` — **35 számozott migráció** (`001_*.sql` … `035_job_questions.sql`)
  - Pl. `021_kyc_and_license`, `026_towing`, `027_progressive_kyc`,
    `034_email_verification_password_reset`, `035_job_questions`
- RLS **minden táblán KI** (backend service-role-on csatlakozik) — az anon-key
  SOHA ne kerüljön frontendre.

---

## 2. Web — `web/`

Next.js 14 App Router + TypeScript. Vercel-en deployol (main → production).

### 2.1 A híd: `web/src/api.ts` (836 sor)

A frontend EGYETLEN kapcsolódási pontja a backendhez.
- `BASE_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:4000'`
- JWT a `localStorage`-ban: kulcs `gofuvar_token` (user `gofuvar_user`)
- minden hívás `Authorization: Bearer <token>` headerrel megy
- **Globális event-ek** (a fetch-wrapper diszpécseli, komponensek hallgatják):
  | Event | Mikor | Ki hallgatja |
  |---|---|---|
  | `gofuvar:session-expired` | 401 → token törlés | auth/layout (auto-logout) |
  | `gofuvar:kyc-required` | 403 + KYC hibakód | **KycModal** (auto-popup) |
  | `gofuvar:outside-coverage` | coverage-en kívüli cím | CoverageModal |
  | `gofuvar:cookie-consent` | süti-döntés | AiChatWidget (átfedés-elkerülés) |

> Ez a publish-subscribe minta a kulcs: a KYC-modal és társai nincsenek
> minden oldalba beágyazva — globálisan mountolva vannak (layout.tsx), és
> event-re reagálnak. Ha "miért nyílik meg magától a KYC?" → ez az ok.

### 2.2 Route-ok — `web/app/`

Belépő: `layout.tsx` (globális provider-ek: KycModalProvider, ToastProvider,
AiChatWidget, CookieConsentBanner, header/footer).

**Publikus / auth:**
- `page.tsx` (landing), `bejelentkezes`, `elfelejtett-jelszo`, `jelszo-reset`,
  `email-megerositese`, `aszf`, `adatkezeles`

**Feladó oldal — `dashboard/`:**
- `dashboard/page.tsx` (áttekintő), `uj-fuvar` (új fuvar feladás),
  `fuvar/[id]` (fuvar részletek + licitek elfogadása),
  `foglalasaim`, `hirdeteseim`, `utvonalak`, `utvonal/[id]`

**Sofőr oldal — `sofor/`:**
- `sofor/dashboard`, `sofor/fuvarok` (elérhető fuvarok),
  `sofor/fuvar/[id]` (felvétel + lezárás böngészőből: fotó + kód),
  `sofor/sajat-fuvarok` (`as=assigned`), `sofor/licitjeim`,
  `sofor/utvonalaim`, `sofor/uj-utvonal`, `sofor/utvonal/[id]`,
  `sofor/utvonal/[id]/utba-eso`, `sofor/visszafuvar`

**Mentős — `mentes/`:** `page`, `regisztracio`, `beerkezett`

**Egyéb:** `admin` (CRUD panel), `profil` + `profil/[id]`, `ertesitesek`,
`nyomon-kovetes/[token]` (nyilvános követés), `fizetes-stub`, `ai-chat`

### 2.3 Komponensek — `web/src/components/` (kiemeltek)

| Komponens | Szerep |
|---|---|
| `KycModal.tsx` + `KycModalProvider.tsx` | **Globálisan mountolt** KYC gate. `gofuvar:kyc-required` event-re nyílik. Dokumentumot tölt fel → Gemini OCR → verified/rejected/underage |
| `AiChatWidget.tsx` | Lebegő AI segéd (jobb alsó). Süti-banner-átfedés miatt `consentPending`-ig rejtve |
| `AiMessageContent.tsx` | AI-válasz renderelés (linkek, navigáció) |
| `CookieConsentBanner.tsx` | Süti-banner (`zIndex 9999`, alul). Döntéskor `gofuvar:cookie-consent` event |
| `SiteHeader` / `SiteFooter` | Reszponzív fejléc (mobilon középső nav rejtve) + lábléc |
| `*Map.tsx` (LiveTracking, JobBrowse, RouteBrowse, DashboardOverview) | Google Maps nézetek |
| `ChatBox`, `DisputeButton`, `ReviewBox`, `JobQuestions` | fuvar-interakciók |
| `PriceCalculator`, `PriceComparison`, `CoverageModal` | árazás, coverage |
| `EmailVerifyBanner`, `InstallPromptBanner`, `TestModeBanner` | állapot-bannerek |
| `CarrierTripPanel` | sofőri aktív-fuvar panel (felvétel/lezárás) |

### 2.4 Lib — `web/src/lib/`

| Fájl | Mit |
|---|---|
| `auth.ts` | `useCurrentUser()` hook, token kezelés |
| `i18n.tsx` | nyelvválasztó / fordítások (`web/src/locales/`) |
| `maps.ts` | Google Maps betöltés (kulcs ÉL) |
| `socket.ts` | Socket.io kliens (élő tracking/chat) |
| `packageSizes.ts` | csomagméret-definíciók |

---

## 3. Mobile — `mobile/`

Expo React Native. **NEM élesedett** (phase 2, Apple-jóváhagyás után).
A natív app első nagy értéke: **background GPS + proximity-SMS** (a böngészős
flow ezt nem tudja — lásd memory: native-gps-sms-roadmap).
Az `expo: ~54.0.0` pin SDK 52 deps-szel **szándékos** — ne piszkáld.

---

## 4. Hol kezdj keresni? (gyakori feladatok)

| "Hozzá akarok nyúlni…" | Kezdd itt |
|---|---|
| egy API-endpointhoz | `backend/src/routes/` + nézd a `router.<method>('/út')`-at (legtöbb `/`-en) |
| fizetéshez / díjhoz | `services/connectionFee.js` (sávok) + `services/barion.js` + `routes/payments.js` (STUB!) |
| KYC-hez | `services/kyc.js` + `services/gemini.js` (backend) / `KycModal.tsx` (web) |
| egy frontend-hívás formátumához | `web/src/api.ts` (egyetlen híd) |
| authz "ki láthatja ezt a fuvart" | `utils/jobAccess.js` → `getJobParty` |
| dark-mode szín-bug | `web/app/globals.css` → `body, body * { color: var(--text) }` felülírja mindent; inline `color` kell explicit |
| üzleti számhoz (díj, plafon) | `backend/src/services/connectionFee.js` (díjsávok) + `backend/src/constants.js` + CLAUDE.md #5 (NE írd felül egyoldalúan) |
| séma / új mező | `backend/db/migrations/` (új számozott fájl) |

---

## 5. Külső kulcs-állapot (mi él, mi STUB)

| Szolgáltatás | Állapot | Blokkol? |
|---|---|---|
| Gemini AI | ÉL | — |
| Google Maps | ÉL | — |
| R2 storage | ÉL (még publikus bucket) | — |
| Neon Postgres | ÉL | — |
| **Barion (fizetés)** | **STUB** | sima webshop-szerződés kell (a kápé-modellel az escrow/Bridge már NEM blokker) |
| Resend (email) | STUB | kulcsra vár |
| SeeMe.hu (SMS) | STUB | kulcs "elvileg megvan", bekötés hátra |
| Sentry | STUB | DSN-re vár |

> A STUB-ok kulcs nélkül nem dobnak hibát — fake/no-op választ adnak, így a
> tesztelő minden funkciót végig tud vinni fizetés/SMS/email nélkül is.

---

## 6. Tesztek — `web/` (Vitest + React Testing Library)

```bash
cd web
npm test          # egyszeri futás (vitest run)
npm run test:watch  # figyelő mód fejlesztéshez
```

| Fájl | Mit fed le |
|---|---|
| `src/lib/packageSizes.test.ts` | csomag-besorolás tiszta logika (S/M/L/XL, túllépés, súly, null) |
| `src/api.test.ts` | a híd `request()` wrapper: token-fejléc, 401→kijelentkezés+event, 403 KYC/coverage event-ek |
| `src/components/ReviewBox.test.tsx` | értékelés: csillag-validáció + küldés |
| `src/components/CarrierTripPanel.test.tsx` | sofőr felvétel/kézbesítés: fotó- és 6-jegyű-kód validáció |
| `app/sofor/uj-utvonal/page.test.tsx` | útvonal-hirdetés form: "mi hiányzik" + publikálás |
| `app/dashboard/utvonal/[id]/page.test.tsx` | feladó foglalás: méret-besorolás + cím-megerősítés validáció |

**Konfiguráció:**
- `web/vitest.config.mts` — **`.mts` kötelező** (a projekt nem ESM, a `.ts`
  config CJS-ként töltődne és elbukna ESM-only plugineken). A `@/*` aliast
  kézzel tükrözi (nincs ESM-only `vite-tsconfig-paths`).
- `web/vitest.setup.ts` — jest-dom matcherek + DOM-cleanup minden teszt után.
- A nehéz/külső gyerekeket (Google Maps-es `CityTagsInput`/`AddressAutocomplete`,
  `next/navigation`, `@/api`, `useToast`) `vi.mock`-kal helyettesítjük.
- A teszt-fájlok nem törik a `next build`-et (csak típus-ellenőrzött melléklet).
