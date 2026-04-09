# GoFuvar – Web

Next.js 14 (App Router) + TypeScript. A Shipper Dashboard, Carrier nézet,
Admin Panel és AI segéd egyetlen app-ban.

## Indítás

```bash
cd web
cp .env.example .env.local
# .env.local-ba írd be a Google Maps kulcsod:
#   NEXT_PUBLIC_GOOGLE_MAPS_KEY=AIza...
npm install
npm run dev           # → http://localhost:3000
```

## Fő oldalak

- `/`                       – Egységes HomeHub, role szerint más kártyákkal
- `/bejelentkezes`          – Login, role-alapú redirect a hubra
- `/ertesitesek`            – Értesítések, real-time badge-gel
- `/dashboard` (shipper)    – Fuvaraim licites
- `/dashboard/uj-fuvar`     – Új fuvar feladás licites
- `/dashboard/foglalasaim`  – Fix áras foglalásaim
- `/dashboard/utvonalak`    – Útba eső sofőrök böngészése
- `/dashboard/utvonal/[id]` – Egy útvonal + foglalás form
- `/dashboard/fuvar/[id]`   – Egy fuvar részletei, élő térkép
- `/sofor/fuvarok` (carrier) – Licitálható fuvarok
- `/sofor/licitjeim`        – Saját licitek listája
- `/sofor/sajat-fuvarok`    – Elfogadott / folyamatban / kész
- `/sofor/utvonalaim`       – Saját hirdetett útvonalak
- `/sofor/uj-utvonal`       – Új útvonal hirdetése
- `/sofor/utvonal/[id]`     – Útvonal részletei + beérkezett foglalások

## AI segéd

A jobb alsó sarokban egy lebegő 🤖 gomb jelenik meg — kérdezhetsz
bármit a GoFuvar platform használatával kapcsolatban. Gemini alapú.
