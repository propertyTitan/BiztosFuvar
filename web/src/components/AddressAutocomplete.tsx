'use client';

// =====================================================================
//  AddressAutocomplete – Google Places Autocomplete + Geocoding
//
//  Használat:
//  <AddressAutocomplete
//    label="Felvétel címe"
//    value={form.pickup_address}
//    onChange={(addr, lat, lng) => { ...form-ba írás... }}
//  />
//
//  Amikor a user kiválaszt egy találatot a legördülőből, automatikusan
//  visszakapod a címet ÉS a koordinátákat. Magyarországra szűr.
//
//  `requirePrecise` (2026-08-04, tesztelői észrevétel): a fuvar felvételi
//  és lerakodási pontjánál NEM elég egy ország / megye / település / irányító-
//  szám találat — a szállítónak házszámig pontos cím kell. Ilyenkor a
//  komponens a pontatlan találatot ELUTASÍTJA (nem hívja meg az onChange-et),
//  és az `onImprecise` visszahíváson keresztül jelzi, mi a baj. A lane-alert
//  (útvonal-figyelő) és az ár-kalkulátor szándékosan NEM használja — ott a
//  város-szintű megadás a helyes viselkedés.
// =====================================================================
import { useRef, useState } from 'react';
import { Autocomplete, useJsApiLoader } from '@react-google-maps/api';
import { GOOGLE_MAPS_ID, GOOGLE_MAPS_LIBRARIES, getGoogleMapsApiKey } from '@/lib/maps';

type Props = {
  label: string;
  value: string;
  onChange: (address: string, lat: number, lng: number) => void;
  onTextChange?: (address: string) => void;
  placeholder?: string;
  required?: boolean;
  /** Házszámig pontos címet követel meg (fuvar felvétel/lerakodás). */
  requirePrecise?: boolean;
  /** requirePrecise mellett: a kiválasztott találat túl pontatlan volt. */
  onImprecise?: (message: string) => void;
};

/** Egy address_component típusának megléte. */
function hasComponent(
  place: google.maps.places.PlaceResult,
  type: string,
): boolean {
  return (place.address_components || []).some((c) => c.types.includes(type));
}

/**
 * Elég pontos-e a találat a fuvarhoz?
 *
 * Elfogadjuk, ha a Google konkrét házszámot (`street_number`) ad vissza, vagy
 * ha az adott cím épület-azonosítóval (`premise` / `subpremise`) szerepel a
 * címtárban — ezek is egyértelműen beazonosítható kapuig visznek.
 * Üzlet/POI (pl. IKEA áruház) esetén a Google a hozzá tartozó utcát+házszámot
 * is visszaadja az address_components-ben, így az is átmegy.
 *
 * Visszatérés: null, ha rendben — különben a usernek szóló hibaüzenet.
 */
export function precisionError(
  place: google.maps.places.PlaceResult,
): string | null {
  if (hasComponent(place, 'street_number')) return null;
  if (hasComponent(place, 'premise') || hasComponent(place, 'subpremise')) return null;

  // Mi lett kiválasztva helyette? A hibaüzenetet ehhez igazítjuk, hogy a user
  // tudja, mit kell pontosítania.
  if (hasComponent(place, 'route')) {
    return 'Ez csak az utca — add meg a házszámot is (pl. „Váci út 1”), és úgy válassz a listából.';
  }
  return 'Ez csak egy település / terület. Add meg a pontos címet utcával és házszámmal, majd válassz a legördülő listából.';
}

export default function AddressAutocomplete({
  label,
  value,
  onChange,
  onTextChange,
  placeholder,
  required,
  requirePrecise,
  onImprecise,
}: Props) {
  const apiKey = getGoogleMapsApiKey();
  const { isLoaded } = useJsApiLoader({
    googleMapsApiKey: apiKey,
    id: GOOGLE_MAPS_ID,
    libraries: GOOGLE_MAPS_LIBRARIES,
  });

  const autocompleteRef = useRef<google.maps.places.Autocomplete | null>(null);
  // Amit a user ténylegesen BEGÉPELT (a widget kiválasztáskor felülírja a
  // mező tartalmát, ezért külön őrizzük — a házszám sokszor csak ebben van).
  const typedRef = useRef('');
  const [checking, setChecking] = useState(false);

  /**
   * Mentőág a házszám-követelményhez.
   *
   * A Places Autocomplete magyar címeknél a gyakorlatban NEM kínál házszámos
   * javaslatot: a „Budapest, Váci út 1" gépelésre is utca- és üzlet-találatok
   * jönnek (élesben mérve). A Geocoder viszont ugyanezt a szöveget pontosan
   * feloldja („Budapest, Váci út 1, 1062 Hungary", street_number-rel).
   * Ezért ha a kiválasztott javaslatból hiányzik a házszám, még egyszer
   * nekifutunk a BEGÉPELT szöveggel — és csak ha az is pontatlan, akkor
   * kérjük el a házszámot a usertől.
   */
  async function rescueWithGeocoder(typed: string): Promise<boolean> {
    const query = typed.trim();
    if (!query || !window.google?.maps?.Geocoder) return false;
    try {
      const geocoder = new window.google.maps.Geocoder();
      const { results } = await geocoder.geocode({ address: query, region: 'hu' });
      const hit = results?.[0];
      if (!hit || precisionError(hit as unknown as google.maps.places.PlaceResult)) return false;
      const loc = hit.geometry?.location;
      if (!loc) return false;
      onImprecise?.('');
      onChange(hit.formatted_address || query, loc.lat(), loc.lng());
      return true;
    } catch {
      // Hálózati / kvóta hiba: ne blokkoljunk némán — a hívó a szokásos
      // „add meg a házszámot" üzenetet fogja mutatni.
      return false;
    }
  }

  async function handlePlaceChanged() {
    const place = autocompleteRef.current?.getPlace();
    if (!place) return;
    const loc = place.geometry?.location;
    if (!loc) return;
    const formatted = place.formatted_address || place.name || '';
    const typed = typedRef.current;

    if (requirePrecise) {
      const problem = precisionError(place);
      if (problem) {
        // A szöveget meghagyjuk a mezőben (a user tudja folytatni a gépelést),
        // de koordinátát NEM adunk vissza → a cím nem számít megerősítettnek.
        onTextChange?.(formatted);
        setChecking(true);
        const rescued = await rescueWithGeocoder(typed);
        setChecking(false);
        if (!rescued) onImprecise?.(problem);
        return;
      }
    }

    onImprecise?.('');
    onChange(formatted, loc.lat(), loc.lng());
  }

  if (!apiKey) {
    return (
      <div>
        <label>{label}</label>
        <input
          className="input"
          value={value}
          onChange={(e) => onTextChange?.(e.target.value)}
          placeholder="Google Maps kulcs hiányzik – kézi beírás"
          required={required}
        />
      </div>
    );
  }

  if (!isLoaded) {
    return (
      <div>
        <label>{label}</label>
        <input className="input" value={value} disabled placeholder="Térkép betöltése…" />
      </div>
    );
  }

  return (
    <div>
      <label>{label}</label>
      <Autocomplete
        onLoad={(ac) => { autocompleteRef.current = ac; }}
        onPlaceChanged={handlePlaceChanged}
        options={{
          // Európa-szintű coverage: NEM korlátozzuk országra (Google csak
          // 5 országot enged a componentRestrictions-ben, ami nem fedi le
          // az EU-t). Magyar felhasználóknál a nyelvi + IP-alapú bias
          // miatt magyar címek továbbra is első helyen jönnek.
          //
          // address_components + types: a házszám-ellenőrzéshez kell
          // (requirePrecise).
          fields: ['formatted_address', 'geometry.location', 'name', 'address_components', 'types'],
          // A legördülőt SZÁNDÉKOSAN nem szűrjük `types: ['address']`-re:
          // magyar címeknél az sem hozott házszámos javaslatot (mérve), az
          // üzlet-találatokat (IKEA, OBI) viszont kizárná a „Hozasd el"
          // flow-ból. A házszámot a rescueWithGeocoder biztosítja.
        }}
      >
        <input
          className="input"
          value={value}
          onChange={(e) => {
            typedRef.current = e.target.value;
            onTextChange?.(e.target.value);
          }}
          placeholder={placeholder || 'Kezdd el beírni a címet…'}
          required={required}
          autoComplete="off"
        />
      </Autocomplete>
      {checking && (
        <p className="muted" style={{ fontSize: 12, marginTop: 6 }}>
          Cím pontosítása…
        </p>
      )}
    </div>
  );
}
