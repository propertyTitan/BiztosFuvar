# BiztosFuvar Mobile (Expo)

React Native (Expo) app sofőröknek és feladóknak.

## Tervezett képernyők

### Sofőr mód
- **Licitlista** – nyitott fuvarok távolság szerint (`GET /jobs?lat&lng&radius_km`).
- **Licit feladás** – `POST /jobs/:id/bids`.
- **Aktív fuvar** – navigáció indítása + `pickup` és `dropoff` fotó kamerával
  (`POST /jobs/:id/photos`, `kind=pickup|dropoff`, GPS metaadattal).
- **Élő pozíció küldés** – háttérben `POST /jobs/:id/location`.

### Feladó mód
- **Hirdetés feladása** mobil­ról.
- **Sofőr követése** térképen (Socket.IO `tracking:ping`).
- **Értékelés** lerakodás után (`POST /jobs/:id/reviews`).

## Indulás (placeholder)

```bash
cd mobile
npx create-expo-app@latest .
# majd: react-native-maps, expo-camera, expo-location, socket.io-client
```

## API kliens

Lásd `mobile/src/api.ts` (TypeScript) – ugyanazokat a végpontokat hívja, mint a
web kliens.
