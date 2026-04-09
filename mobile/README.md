# GoFuvar – Mobile (Expo)

React Native / Expo SDK 54 app. Egyetlen alkalmazás, ami mindkét
szerepkörben (feladó + sofőr) működik. Role szerint másképp jelenik
meg a kezdő hub, de minden felhasználó ugyanazt az app-ot használja.

## Mit tud

### Feladó mód
- **Új fuvar feladása** (licites) — cím autocomplete-tel, méretek, súly, fotók
- **Útba eső sofőrök** böngészése és helyfoglalás fix áron
- **Fuvaraim** — licites + foglalt fuvarok összesítve
- **Foglalásaim** — a fix áras foglalásaid állapota
- **Értesítések** — real-time push a sofőr megerősítéséről / elutasításáról

### Sofőr mód
- **Licitálható fuvarok** — GPS-közelség szerint rendezve
- **Útvonalaim** — saját hirdetett útvonalak kezelése
- **Új útvonal hirdetése** — tagek a megállókhoz, méret/ár tábla
- **Licitjeim** — miket ajánlottál, mi nyert
- **Saját fuvaraim** — elfogadott, folyamatban, teljesített
- **📸 Fuvar lezárása** — kötelező fotó + 6 jegyű átvételi kód

### Közös
- **🔔 Értesítések** real-time Socket.IO-n
- **🤖 AI segéd** — kérdezz bármit a GoFuvar működéséről

## Indítás

```bash
cd mobile
# .env fájl létrehozás (gitignore-olt):
#   GOOGLE_MAPS_API_KEY=AIza...
#   EXPO_PUBLIC_GOOGLE_MAPS_KEY=AIza...
#   EXPO_PUBLIC_API_URL=http://<gép-LAN-IP>:4000
npm install
npx expo start --clear
```

Utána szkenneld be a QR kódot Expo Go-val (iOS).
