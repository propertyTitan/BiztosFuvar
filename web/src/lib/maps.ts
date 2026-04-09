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

export function getGoogleMapsApiKey(): string {
  return process.env.NEXT_PUBLIC_GOOGLE_MAPS_KEY || '';
}
