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
// =====================================================================
import { useRef } from 'react';
import { Autocomplete, useJsApiLoader } from '@react-google-maps/api';
import { GOOGLE_MAPS_ID, GOOGLE_MAPS_LIBRARIES, getGoogleMapsApiKey } from '@/lib/maps';

type Props = {
  label: string;
  value: string;
  onChange: (address: string, lat: number, lng: number) => void;
  onTextChange?: (address: string) => void;
  placeholder?: string;
  required?: boolean;
};

export default function AddressAutocomplete({
  label,
  value,
  onChange,
  onTextChange,
  placeholder,
  required,
}: Props) {
  const apiKey = getGoogleMapsApiKey();
  const { isLoaded } = useJsApiLoader({
    googleMapsApiKey: apiKey,
    id: GOOGLE_MAPS_ID,
    libraries: GOOGLE_MAPS_LIBRARIES,
  });

  const autocompleteRef = useRef<google.maps.places.Autocomplete | null>(null);

  function handlePlaceChanged() {
    const place = autocompleteRef.current?.getPlace();
    if (!place) return;
    const loc = place.geometry?.location;
    if (!loc) return;
    const formatted = place.formatted_address || place.name || '';
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
          componentRestrictions: { country: 'hu' },
          fields: ['formatted_address', 'geometry.location', 'name'],
        }}
      >
        <input
          className="input"
          value={value}
          onChange={(e) => onTextChange?.(e.target.value)}
          placeholder={placeholder || 'Kezdd el beírni a címet…'}
          required={required}
          autoComplete="off"
        />
      </Autocomplete>
    </div>
  );
}
