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

```bash
# Backend
cd backend
cp .env.example .env
npm install
npm run db:init    # séma betöltése PostgreSQL-be
npm run dev
```

Részletek: [backend/README.md](backend/README.md).
