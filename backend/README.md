# BiztosFuvar Backend

Node.js + Express + PostgreSQL + Google Gemini + Socket.IO.

## Indítás

```bash
cp .env.example .env
npm install
npm run db:init   # séma betöltése
npm run dev
```

A szerver alapból a `http://localhost:4000` címen indul.

## Végpontok (összefoglaló)

### Auth
| Method | Útvonal           | Leírás                            |
|--------|-------------------|-----------------------------------|
| POST   | `/auth/register`  | Új felhasználó (shipper/carrier)  |
| POST   | `/auth/login`     | Bejelentkezés, JWT token visszaad |

### Jobs
| Method | Útvonal             | Szerepkör | Leírás                         |
|--------|---------------------|-----------|--------------------------------|
| POST   | `/jobs`             | shipper   | Új hirdetés (AI ellenőrzéssel) |
| GET    | `/jobs`             | bárki     | Aktív fuvarok (közelség)       |
| GET    | `/jobs/:id`         | bárki     | Egy fuvar lekérdezése          |
| GET    | `/jobs/mine/list`   | bárki     | Saját fuvarok                  |

### Bids (Licit + Escrow)
| Method | Útvonal                  | Szerepkör | Leírás                        |
|--------|--------------------------|-----------|-------------------------------|
| POST   | `/jobs/:jobId/bids`      | carrier   | Új licit                      |
| GET    | `/jobs/:jobId/bids`      | bárki     | Licitek listája               |
| POST   | `/bids/:id/accept`       | shipper   | Licit elfogadása + Escrow     |

### Photos (Proof of Delivery 2.0)
| Method | Útvonal                | Leírás                                            |
|--------|------------------------|---------------------------------------------------|
| POST   | `/jobs/:jobId/photos`  | Multipart fotó + GPS + Gemini elemzés + workflow  |
| GET    | `/jobs/:jobId/photos`  | Fotók listája                                     |

A `dropoff` fotó automatikusan ellenőrzi:
`distance(GPS, dropoff_target) <= DELIVERY_MAX_DISTANCE_METERS` (alapértelmezett **50 m**).
Ha igen → `jobs.status = 'delivered'`, az escrow letét **`released`**.

### Tracking
| Method | Útvonal                          | Szerepkör | Leírás              |
|--------|----------------------------------|-----------|---------------------|
| POST   | `/jobs/:jobId/location`          | carrier   | Pozíció ping        |
| GET    | `/jobs/:jobId/location/last`     | bárki     | Utolsó pozíció      |

### Reviews
| Method | Útvonal                  | Leírás                       |
|--------|--------------------------|------------------------------|
| POST   | `/jobs/:jobId/reviews`   | Kétirányú (1–5) értékelés    |

## Real-time események (Socket.IO)

A kliens csatlakozás után emit-eli: `socket.emit('job:join', jobId)`.

| Esemény                  | Payload                       |
|--------------------------|-------------------------------|
| `jobs:new` (globális)    | `Job`                         |
| `bids:new`               | `Bid`                         |
| `job:accepted`           | `{ job_id, carrier_id, ... }` |
| `job:picked_up`          | `{ job_id, photo }`           |
| `job:delivered`          | `{ job_id, photo, validation }` |
| `job:dropoff_rejected`   | `{ job_id, photo, validation }` |
| `tracking:ping`          | `{ job_id, lat, lng, ts }`    |

## AI réteg (Gemini)

`src/services/gemini.js`:
- `analyzeCargoPhoto(buffer, mime, kind)` – fotó "szemrevételezése",
  visszaadja: `{ has_cargo, confidence, notes }`.
- `reviewJobDescription(title, description)` – hirdetés moderálás.

Ha nincs `GEMINI_API_KEY`, stub választ ad, hogy a workflow tesztelhető maradjon.
