// Egyszerű Google Places Autocomplete + Geocode kliens a mobilhoz.
// A Places "új" Autocomplete API-t használja (autocomplete:autocomplete + details),
// a régi API helyett, mert az újat preferálja a Google, és ingyenes kvótája
// is bőségesebb.
//
// Szükséges: EXPO_PUBLIC_GOOGLE_MAPS_KEY env változó (mobile/.env).
// A Google Cloud Console-ban engedélyezve kell hogy legyen:
//   - Places API (New) vagy Places API (legacy)

import Constants from 'expo-constants';

const API_KEY =
  process.env.EXPO_PUBLIC_GOOGLE_MAPS_KEY ||
  (Constants?.expoConfig?.extra as any)?.googleMapsApiKey ||
  '';

export type PlaceSuggestion = {
  placeId: string;
  description: string;
};

export type PlaceDetails = {
  address: string;
  lat: number;
  lng: number;
};

/**
 * Autocomplete találatok a beírt szövegre.
 * Magyarországra szűrve, magyar nyelvű válaszokkal.
 */
export async function autocompletePlaces(input: string): Promise<PlaceSuggestion[]> {
  if (!input.trim() || !API_KEY) return [];
  const url = `https://maps.googleapis.com/maps/api/place/autocomplete/json` +
    `?input=${encodeURIComponent(input)}` +
    `&language=hu` +
    `&components=country:hu` +
    `&key=${API_KEY}`;
  try {
    const res = await fetch(url);
    const data = await res.json();
    if (data.status !== 'OK' && data.status !== 'ZERO_RESULTS') {
      console.warn('[places] autocomplete:', data.status, data.error_message);
      return [];
    }
    return (data.predictions || []).map((p: any) => ({
      placeId: p.place_id,
      description: p.description,
    }));
  } catch (err) {
    console.warn('[places] autocomplete hiba:', err);
    return [];
  }
}

/**
 * Egy place_id részleteinek lekérése – cím + koordináta.
 */
export async function getPlaceDetails(placeId: string): Promise<PlaceDetails | null> {
  if (!API_KEY) return null;
  const url = `https://maps.googleapis.com/maps/api/place/details/json` +
    `?place_id=${encodeURIComponent(placeId)}` +
    `&fields=formatted_address,geometry/location,name` +
    `&language=hu` +
    `&key=${API_KEY}`;
  try {
    const res = await fetch(url);
    const data = await res.json();
    if (data.status !== 'OK') {
      console.warn('[places] details:', data.status, data.error_message);
      return null;
    }
    const r = data.result;
    return {
      address: r.formatted_address || r.name || '',
      lat: r.geometry?.location?.lat,
      lng: r.geometry?.location?.lng,
    };
  } catch (err) {
    console.warn('[places] details hiba:', err);
    return null;
  }
}
