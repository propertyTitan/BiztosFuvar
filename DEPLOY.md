# GoFuvar — Első éles telepítés (Vercel + Railway + Neon)

Ez az útmutató végigvezet azon, hogyan rakd online a **webet** és a
**backendet** a saját domainoddal. A mobil app (Expo) egyelőre marad
lokális fejlesztésben.

---

## Architektúra

```
  böngésző ─┐
            │  https://gofuvar.hu
            ▼
    ┌─────────────┐                 ┌──────────────┐
    │   Vercel    │ ── fetch ──▶    │   Railway    │
    │  (Next.js   │                 │  (Express +  │
    │    web/)    │ ◀── Socket.IO ──│  Socket.IO)  │
    └─────────────┘                 └──────┬───────┘
                                           │
                                           ▼
                                    ┌──────────────┐
                                    │  Neon / Sup. │
                                    │  (Postgres)  │
                                    └──────────────┘
```

- **Frontend**: Vercel (ingyenes Hobby tier) — `web/` mappa
- **Backend**: Railway (~$5/hó) vagy Render.com free tier — `backend/` mappa
- **Postgres**: Neon.tech (ingyenes) vagy Supabase (ingyenes)
- **Domain**: ahol vetted — csak DNS rekordokat kell beállítani

---

## 1. lépés — Postgres DB (Neon)

1. Menj a https://neon.tech oldalra, regisztrálj Google/GitHub fiókkal.
2. **Create project** → Név: `gofuvar`, Region: `Frankfurt (eu-central-1)`.
3. A dashboardon a **Connection Details** panelen másold ki a
   **pooled connection string**-et. Valami ilyet kapsz:
   ```
   postgres://user:PASSWORD@ep-xxx-pooler.eu-central-1.aws.neon.tech/neondb?sslmode=require
   ```
4. Ezt a stringet nevezd el `DATABASE_URL`-nek — kelleni fog a Railway
   beállításkor.

> **Alternatíva**: Supabase is jó, ugyanaz a connection string formátum.

---

## 2. lépés — Backend (Railway)

1. Menj a https://railway.app oldalra, **Login with GitHub**.
2. **New Project** → **Deploy from GitHub repo** → válaszd ki a
   `propertytitan/biztosfuvar` repot.
3. A project dashboardon:
   - **Settings → Root Directory**: `backend`
   - **Settings → Build Command**: *(üres, Railway auto-detektál)*
   - **Settings → Start Command**: `npm start`
4. **Variables** fül → add hozzá ezeket:

   | Kulcs | Érték |
   |---|---|
   | `PORT` | `4000` |
   | `NODE_ENV` | `production` |
   | `JWT_SECRET` | *(random 32+ karakter, pl. `openssl rand -hex 32`)* |
   | `DATABASE_URL` | *(a Neon pooled connection string)* |
   | `PGSSL` | `require` |
   | `CORS_ORIGIN` | `https://gofuvar.hu,https://www.gofuvar.hu` |
   | `GEMINI_API_KEY` | *(a saját Gemini kulcsod)* |
   | `GEMINI_MODEL` | `gemini-2.5-flash` |
   | `GOOGLE_MAPS_API_KEY` | *(opcionális)* |
   | `DELIVERY_MAX_DISTANCE_METERS` | `50` |
   | `BARION_POS_KEY` | *(üres — STUB mód)* |
   | `PLATFORM_COMMISSION_PCT` | `0.10` |
   | `WEB_BASE_URL` | `https://gofuvar.hu` |
   | `API_BASE_URL` | `https://api.gofuvar.hu` |

5. **Deploy** — Railway automatikusan feltelepíti és elindítja.
6. A **Deployments** fülön egy `*.up.railway.app` URL-t kapsz — ezen
   már él a backend. Teszteld:
   ```
   curl https://<railway-url>.up.railway.app/health
   → {"ok":true,"service":"gofuvar-backend"}
   ```

### 2b. Migrációk futtatása a prod DB-n

A Railway Shell (**Settings → Service → Shell**) megnyitásával:
```bash
npm run db:init    # egyszeri séma betöltés
npm run db:migrate # az összes migráció idempotensen
```

Vagy lokálból is lefuttathatod, ha a `DATABASE_URL` env-et beállítod
a Neon connection stringre:
```bash
cd backend
DATABASE_URL="postgres://..." PGSSL=require npm run db:init
DATABASE_URL="postgres://..." PGSSL=require npm run db:migrate
```

---

## 3. lépés — Frontend (Vercel)

1. Menj a https://vercel.com oldalra, **Login with GitHub**.
2. **Add New → Project** → válaszd a `propertytitan/biztosfuvar` repot.
3. **Configure Project** képernyőn:
   - **Framework Preset**: `Next.js` (auto-detect)
   - **Root Directory**: kattints az **Edit** gombra, írd át `web`-re
   - **Build Command**: *(üres, auto)*
   - **Output Directory**: *(üres, auto)*
4. **Environment Variables**:

   | Kulcs | Érték |
   |---|---|
   | `NEXT_PUBLIC_API_URL` | `https://api.gofuvar.hu` |
   | `NEXT_PUBLIC_GOOGLE_MAPS_KEY` | *(opcionális, a saját maps kulcsod)* |

5. **Deploy** — 1-2 perc alatt elkészül.
6. Kapsz egy `gofuvar-xxx.vercel.app` URL-t. Nyisd meg — ott az app!
   (Az API hívások még a Railway URL-re mennek, mert a `NEXT_PUBLIC_API_URL`-t
   mindig csak a domain-beállítás után frissítjük.)

---

## 4. lépés — Saját domain bekötése

Tegyük fel a domain neved **`gofuvar.hu`** (cseréld a sajátodra).

### 4a. Vercel — `gofuvar.hu` + `www.gofuvar.hu`

1. Vercel project **Settings → Domains**.
2. Add meg: `gofuvar.hu` → **Add**.
3. Vercel mondani fogja, hogy tegyél egy **A record**-ot a domain
   DNS-ébe:
   ```
   Type: A
   Name: @
   Value: 76.76.21.21
   ```
4. Add meg: `www.gofuvar.hu` → **Add**.
5. Vercel mondani fogja:
   ```
   Type: CNAME
   Name: www
   Value: cname.vercel-dns.com
   ```

### 4b. Railway — `api.gofuvar.hu`

1. Railway project **Settings → Networking → Custom Domain**.
2. Add meg: `api.gofuvar.hu`.
3. Railway mondani fogja:
   ```
   Type: CNAME
   Name: api
   Value: <valami>.up.railway.app
   ```

### 4c. DNS beállítás a domain regisztrátornál

Menj a domain regisztrátorod DNS-kezelőjébe (vagy ha Cloudflare-en van,
oda) és vedd fel ezt a **3 rekordot**:

| Type  | Name | Value                        |
|-------|------|------------------------------|
| A     | @    | 76.76.21.21                  |
| CNAME | www  | cname.vercel-dns.com         |
| CNAME | api  | *(Railway által adott URL)*  |

DNS propagáció általában 5-30 perc, max. 24 óra.

### 4d. Vercel env frissítés

Miután a `api.gofuvar.hu` él:
1. Vercel project **Settings → Environment Variables**.
2. `NEXT_PUBLIC_API_URL` → `https://api.gofuvar.hu` (ha még nem ez).
3. **Deployments → redeploy** → újraépíti a frontendet az új URL-lel.

---

## 5. lépés — Ellenőrzés

1. `https://gofuvar.hu` — betölt a GoFuvar, bejelentkezés megy.
2. Regisztrálj egy új user-t — létrejön a Neon DB-ben.
3. Adj fel egy licites fuvart — megjelenik.
4. Másik böngészőben nézd meg valós időben — a Socket.IO is megy.

**Ha valami nem megy**, tipikus hibák:
- **CORS hiba a konzolban** → ellenőrizd, hogy `CORS_ORIGIN` a Railway env-ben
  pontosan `https://gofuvar.hu,https://www.gofuvar.hu` (semmi szóköz, teljes URL)
- **500 minden requestre** → Railway Logs → valószínűleg a DB nem érhető el →
  `PGSSL=require` és helyes `DATABASE_URL`?
- **"Failed to fetch"** → `NEXT_PUBLIC_API_URL` még a Railway default URL-t
  használja → Vercelen frissítsd és redeploy.

---

## Ismert korlátok — mi NEM működik még prod-ban

- **Fotó feltöltés**: a mostani `backend/uploads/` mappa minden Railway
  restart után elvész (ephemeral FS). **Megoldás**: Cloudflare R2 vagy
  AWS S3 integráció. Ez külön feladat — addig a listing/pickup/dropoff
  fotók helyben vannak csak.
- **Barion éles fizetés**: most STUB módban fut (`BARION_POS_KEY` üres) —
  ez demohoz/béta teszthez OK. Élesítéshez Barion POS regisztráció kell.
- **Email küldés**: `RESEND_API_KEY` üres → csak konzolra logol.

Ezeket nyugodtan **a deploy után** is pótolhatjuk, mikor már van fent
valami megmutatható állapot.

---

## Költségek (első hónapok)

| Szolgáltatás | Ingyen | Fizetős határ |
|---|---|---|
| Vercel Hobby | ✅ | 100 GB bandwidth/hó |
| Railway Hobby | $5 ingyen credit | Kb. egy kis app ennyiből kitart |
| Neon Free tier | ✅ | 0.5 GB storage, 1 DB |
| Domain | ❌ | ~10 EUR/év |

Összesen: **gyakorlatilag 0 Ft/hó** egy kisforgalmú demo-hoz, amíg a
Railway $5 credit elég.
