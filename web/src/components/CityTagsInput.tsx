'use client';

// Városok tag-szerű beviteli komponense Google Places-szel.
// - A user beír egy várost, kiválasztja a legördülőből
// - A városok tag-ekként jelennek meg fölötte, ×-szel eltávolíthatók
// - A sorrend megőrződik (első = kiindulás, utolsó = cél)
// - Minden tag tartalmazza a lat/lng-t is, amit a Places API-tól kapunk
import { useRef, useState } from 'react';
import { Autocomplete, useJsApiLoader } from '@react-google-maps/api';
import { GOOGLE_MAPS_ID, GOOGLE_MAPS_LIBRARIES, getGoogleMapsApiKey } from '@/lib/maps';
import type { Waypoint } from '@/api';

type Props = {
  value: Waypoint[];
  onChange: (waypoints: Waypoint[]) => void;
  label?: string;
  placeholder?: string;
};

export default function CityTagsInput({ value, onChange, label, placeholder }: Props) {
  const apiKey = getGoogleMapsApiKey();
  const { isLoaded } = useJsApiLoader({
    googleMapsApiKey: apiKey,
    id: GOOGLE_MAPS_ID,
    libraries: GOOGLE_MAPS_LIBRARIES,
  });
  const autocompleteRef = useRef<google.maps.places.Autocomplete | null>(null);
  const [inputKey, setInputKey] = useState(0);

  function handlePlaceChanged() {
    const place = autocompleteRef.current?.getPlace();
    if (!place) return;
    const loc = place.geometry?.location;
    if (!loc) return;
    const name = place.name || place.formatted_address || '';
    const formatted = place.formatted_address || name;
    const newTag: Waypoint = {
      name,
      formatted_address: formatted,
      lat: loc.lat(),
      lng: loc.lng(),
      order: value.length,
    };
    onChange([...value, newTag]);
    // force-remount az inputot, hogy kiürüljön
    setInputKey((k) => k + 1);
  }

  function removeAt(index: number) {
    const next = value.filter((_, i) => i !== index).map((w, i) => ({ ...w, order: i }));
    onChange(next);
  }

  function moveUp(index: number) {
    if (index === 0) return;
    const copy = [...value];
    [copy[index - 1], copy[index]] = [copy[index], copy[index - 1]];
    onChange(copy.map((w, i) => ({ ...w, order: i })));
  }

  function moveDown(index: number) {
    if (index === value.length - 1) return;
    const copy = [...value];
    [copy[index], copy[index + 1]] = [copy[index + 1], copy[index]];
    onChange(copy.map((w, i) => ({ ...w, order: i })));
  }

  if (!apiKey) {
    return (
      <div className="card" style={{ background: '#fef3c7' }}>
        <strong>⚠️ Google Maps API kulcs hiányzik.</strong>
      </div>
    );
  }

  return (
    <div>
      {label && <label>{label}</label>}

      {/* A meglévő tagek */}
      {value.length > 0 && (
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginBottom: 12 }}>
          {value.map((w, i) => (
            <div
              key={`${w.lat}-${w.lng}-${i}`}
              style={{
                background: i === 0 ? '#dcfce7' : i === value.length - 1 ? '#fee2e2' : '#dbeafe',
                padding: '6px 10px',
                borderRadius: 999,
                fontSize: 14,
                display: 'flex',
                alignItems: 'center',
                gap: 6,
                border: '1px solid var(--border)',
              }}
            >
              <span style={{ fontSize: 11, opacity: 0.7 }}>
                {i === 0 ? 'INDULÁS' : i === value.length - 1 ? 'CÉL' : `${i}.`}
              </span>
              <strong>{w.name}</strong>
              <button
                type="button"
                onClick={() => moveUp(i)}
                disabled={i === 0}
                style={{ background: 'none', border: 'none', cursor: 'pointer', padding: 2, opacity: i === 0 ? 0.3 : 1 }}
                title="Feljebb"
              >
                ↑
              </button>
              <button
                type="button"
                onClick={() => moveDown(i)}
                disabled={i === value.length - 1}
                style={{ background: 'none', border: 'none', cursor: 'pointer', padding: 2, opacity: i === value.length - 1 ? 0.3 : 1 }}
                title="Lejjebb"
              >
                ↓
              </button>
              <button
                type="button"
                onClick={() => removeAt(i)}
                style={{
                  background: 'rgba(0,0,0,0.15)',
                  border: 'none',
                  borderRadius: '50%',
                  width: 20,
                  height: 20,
                  cursor: 'pointer',
                  fontWeight: 700,
                  padding: 0,
                  lineHeight: '18px',
                }}
                title="Eltávolítás"
              >
                ×
              </button>
            </div>
          ))}
        </div>
      )}

      {isLoaded ? (
        // FONTOS: a `key={inputKey}` az <Autocomplete>-en van, nem az <input>-en.
        // A @react-google-maps/api wrapper az onLoad-ban egy google.maps.places.Autocomplete
        // instance-t köt a DOM input-hoz. Ha csak az inputot remount-oljuk,
        // a wrapper a régi DOM node-ra hivatkozik, és a második várost nem
        // fogja autocomplete-elni. A teljes wrapper újracsomagolása kényszerít
        // egy friss Google Autocomplete bind-ot.
        <Autocomplete
          key={inputKey}
          onLoad={(ac) => {
            autocompleteRef.current = ac;
          }}
          onPlaceChanged={handlePlaceChanged}
          options={{
            componentRestrictions: { country: 'hu' },
            types: ['(cities)'],
            fields: ['name', 'formatted_address', 'geometry.location'],
          }}
        >
          <input
            className="input"
            placeholder={
              placeholder ||
              (value.length === 0
                ? 'Kezdd el beírni a kiindulási várost…'
                : 'Adj hozzá egy újabb várost (megállót vagy célt)…')
            }
            autoComplete="off"
          />
        </Autocomplete>
      ) : (
        <input className="input" disabled placeholder="Térkép betöltése…" />
      )}
      <p className="muted" style={{ fontSize: 12, marginTop: 6 }}>
        Legalább 2 város kell: a kiindulás és a cél. Közben annyi megállót adhatsz hozzá, amennyit akarsz.
      </p>
    </div>
  );
}
