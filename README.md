# BiztosFuvar

Magyarországi közösségi fuvartőzsde és bizalmi logisztikai platform.

Kétoldalú piac (Marketplace), ahol a **Feladók** (Shippers) és a **Szállítók**
(Carriers) találkoznak. A bizalom alapköve a **"Proof of Delivery 2.0"**:
kötelező fotózás, GPS-alapú validálás és letéti (Escrow) fizetési rendszer.

## Monorepo struktúra

```
BiztosFuvar/
├── backend/     # Node.js + Express + PostgreSQL API + Gemini AI + Socket.IO
├── web/         # React / Next.js (Shipper Dashboard + Admin Panel)
└── mobile/      # React Native (Expo) – Sofőr és Feladó app
```

## Technológia

| Réteg      | Stack                                                  |
|------------|--------------------------------------------------------|
| Mobil      | React Native (Expo) – iOS & Android                    |
| Web        | React.js / Next.js                                     |
| Backend    | Node.js + Express                                      |
| Adatbázis  | PostgreSQL (Supabase kompatibilis)                     |
| AI         | Google Gemini API (fotó-elemzés, leírás-ellenőrzés)    |
| Térkép     | Google Maps Platform (Autocomplete, Geocoding, Matrix) |
| Real-time  | Socket.IO                                              |

## Bizalmi Lánc (workflow)

1. **Licit** – Feladó hirdetést ad fel, sofőrök licitálnak.
2. **Letét** – Elfogadáskor a fuvardíj letétbe kerül (Escrow szimuláció).
3. **Felvétel** – Sofőr fotót készít az áruról + GPS koordináta rögzítése.
4. **Élő követés** – Feladó térképen látja a sofőr mozgását.
5. **Lerakodás** – Kötelező fotó, `GPS < 50 m a céltól` **ÉS** `fotó feltöltve`
   → a fuvar sikeres.
6. **Kifizetés** – A rendszer felszabadítja a letétet a sofőrnek.

## Indulás

### 1. Backend
```bash
cd backend
cp .env.example .env       # töltsd ki a DATABASE_URL-t (Postgres / Supabase)
npm install
npm run db:init            # séma betöltése
npm run db:seed            # magyar minta felhasználók + fuvarok
npm run dev                # → http://localhost:4000
```

### 2. Web (Shipper Dashboard)
```bash
cd web
cp .env.example .env.local
# .env.local-ba írd be a Google Maps kulcsodat:
#   NEXT_PUBLIC_GOOGLE_MAPS_KEY=AIza...
npm install
npm run dev                # → http://localhost:3000
```

### 3. Mobile (Expo)
```bash
cd mobile
# Hozz létre egy .env fájlt:
#   GOOGLE_MAPS_API_KEY=AIza...
#   EXPO_PUBLIC_GOOGLE_MAPS_KEY=AIza...
#   EXPO_PUBLIC_API_URL=http://<gép-LAN-IP>:4000
npm install
npm start                  # Expo Go vagy szimulátor
```

> **Biztonság**: A `.env`, `.env.local` és `mobile/.env` fájlokat a `.gitignore`
> kizárja — a Google Maps kulcsod **soha** ne kerüljön a repóba. Élesben
> állíts be Google Cloud Console restrictions-t (HTTP referrer + Android/iOS
> bundle ID).

### Google Maps – mit kell engedélyezni

A Google Cloud Console-ban az alábbi API-kat **Enable**:
- **Maps JavaScript API** – web (Shipper Dashboard)
- **Maps SDK for Android** – mobil release
- **Maps SDK for iOS** – mobil release
- **Geocoding API** *(opcionális, később címkereséshez)*
- **Distance Matrix API** *(opcionális, ár-becsléshez)*

Részletek: [backend/README.md](backend/README.md).
