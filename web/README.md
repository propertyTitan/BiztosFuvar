# BiztosFuvar Web

Asztali / böngészős felület. Két fő modul:

1. **Shipper Dashboard** – könnyű hirdetésfeladás, számlák letöltése, aktív
   fuvarok követése nagy térképen.
2. **Admin Panel** – panaszkezelés, sofőr-dokumentumok ellenőrzése,
   statisztikák.

## Tervezett stack

- Next.js (React) + TypeScript
- TailwindCSS
- Google Maps JavaScript API
- Socket.IO kliens a real-time fuvarkövetéshez
- A backend `http://localhost:4000` címen érhető el (lásd `backend/`).

## Indulás (placeholder)

```bash
cd web
npx create-next-app@latest .
# majd: a komponensek bekötése a backend végpontjaira
```

> Ez a mappa egyelőre placeholder – a komponensek a backend API-ra épülnek
> (`/auth`, `/jobs`, `/jobs/:id/bids`, `/jobs/:id/photos`).
