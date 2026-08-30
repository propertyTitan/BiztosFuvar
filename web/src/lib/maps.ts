// Közös Google Maps loader beállítás a web kliensnek.
// Mind az élő követés (LiveTrackingMap, DashboardOverviewMap), mind a
// cím-autocomplete (AddressAutocomplete) ezt használja, így a Google Maps
// JS API csak EGYSZER töltődik be az oldalon (különben a lib figyelmeztet).
import type { Libraries } from '@react-google-maps/api';

export const GOOGLE_MAPS_ID = 'gofuvar-maps';

// A Places autocomplete-hez + geokódoláshoz a `places` library kell.
// FONTOS: ennek konstansnak kell lennie (referencia-stabil), különben a
// useJsApiLoader minden renderre újratöltené a JS API-t.
export const GOOGLE_MAPS_LIBRARIES: Libraries = ['places'];

// GF-023 (Manus, 2026-08-30): magyar UI-ban a térkép-vezérlők angolul
// szóltak, a címek „Hungary"-vel jöttek. A JS API nyelve betöltésKORI
// beállítás — MINDEN useJsApiLoader-hívásnak ugyanezt kell átadnia
// (különböző opciókkal a lib újratöltési hibát dob). A külföldi launchnál
// az i18n-nel együtt válik dinamikussá (lásd i18n.tsx).
export const GOOGLE_MAPS_LANGUAGE = 'hu';
export const GOOGLE_MAPS_REGION = 'HU';

export function getGoogleMapsApiKey(): string {
  return process.env.NEXT_PUBLIC_GOOGLE_MAPS_KEY || '';
}
