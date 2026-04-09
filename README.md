# GoFuvar

**Magyar közösségi fuvartőzsde és bizalmi logisztikai platform.**

> Korábbi munkanév: *BiztosFuvar*. A `gofuvar.hu` domain alatt futó élesítésre
> készülve az egész rendszert átneveztük.

Kétoldalú piactér, ahol a **Feladók** (Shippers) és a **Szállítók**
(Carriers) találkoznak. Két, egymást kiegészítő fuvarmodell:

1. **Licites**: a feladó hirdetést ad fel → a sofőrök licitálnak → a feladó
   elfogadja a legjobbat → Barion escrow → 6 jegyű átvételi kód → kifizetés.
2. **Útvonalas (fix ár)**: a sofőr meghirdeti a tervezett útját (pl. Szeged →
   Kecskemét → Budapest) fix S/M/L/XL csomag árakkal. A feladók helyet
   foglalnak rajta, a sofőr megerősíti, és onnan ugyanaz a Bizalmi Lánc.

A bizalom alapköve: **kötelező fotó + 6 jegyű átvételi kód**, escrow-s
(Barion) fizetés, kétirányú értékelés, és real-time Socket.IO értesítések.

## Monorepo struktúra

```
gofuvar/
├── backend/     # Node.js + Express + PostgreSQL + Gemini + Socket.IO
├── web/         # Next.js 14 (App Router) — shipper + carrier + AI segéd
└── mobile/      # Expo (React Native) — iOS/Android, fotós proof-of-delivery
```

## Mit tud most

### Feladóknak
- Új fuvar feladás autocomplete címekkel, méretekkel, képekkel
- Sofőri útvonalak böngészése → fix áron foglalás
- Fuvaraim + Foglalásaim külön listákban, státuszokkal
- Átvételi kód megjelenítése — ezt adja át a sofőrnek az átvételkor
- Élő követés (térképen piros pötty + nyomvonal)
- Beérkezett licitek elfogadása, Barion escrow szimuláció

### Sofőröknek
- Elérhető fuvarok böngészése GPS közelség alapján
- Licitálás (ár + ETA + üzenet)
- Saját útvonal hirdetése tagekkel, méret/ár táblával, sablonként
  elmenthető újra publikálásra
- Licitjeim + Saját fuvaraim külön nézetben
- **Fuvar lezárása** képernyő: kötelező kamera + 6 jegyű kód

### Közös
- 🔔 **Értesítések** — real-time push, minden fontos eseményre
- 🤖 **AI segéd** — Gemini alapú chatbot, magyar nyelven, a platform
  használatáról
- Egységes **HomeHub** kártya-rács mindkét platformon, role szerint

## Tech stack

| Réteg      | Stack                                             |
|------------|---------------------------------------------------|
| Backend    | Node.js + Express + Socket.IO                     |
| DB         | PostgreSQL (Supabase kompatibilis)                |
| AI         | Google Gemini (fotó elemzés + AI segéd)           |
| Fizetés    | Barion Bridge (Payment Reservation + Split)       |
| Térkép     | Google Maps Platform (Maps JS + Places SDK)       |
| Web        | Next.js 14 (App Router) + TypeScript              |
| Mobil      | Expo SDK 54 + React Native + expo-router          |

## Indítás

### 1. Backend

```bash
cd backend
cp .env.example .env       # DATABASE_URL, JWT_SECRET, stb.
npm install
npm run db:init            # séma betöltése
npm run db:migrate         # a migration fájlok lefuttatása
npm run db:seed            # magyar minta felhasználók + fuvarok
npm run dev                # → http://localhost:4000
```

### 2. Web

```bash
cd web
cp .env.example .env.local
# .env.local-ba a Google Maps kulcsot:
#   NEXT_PUBLIC_GOOGLE_MAPS_KEY=AIza...
npm install
npm run dev                # → http://localhost:3000
```

### 3. Mobil

```bash
cd mobile
# .env fájlba (gitignore-olt):
#   GOOGLE_MAPS_API_KEY=AIza...
#   EXPO_PUBLIC_GOOGLE_MAPS_KEY=AIza...
#   EXPO_PUBLIC_API_URL=http://<gép-LAN-IP>:4000
npm install
npx expo start --clear
```

Utána iPhone-on Expo Go → szkenneld be a QR kódot.

## Logó

A teljes logó SVG-ben: `web/public/logo.svg` (horizontal),
`web/public/logo-icon.svg` (favicon / launcher), `web/public/logo-white.svg`
(monochrome fehér dark háttérre).

A mobil app natív RN komponensekkel rajzolja meg a logót
(`mobile/src/components/Logo.tsx`), hogy ne kelljen új dependencia.
