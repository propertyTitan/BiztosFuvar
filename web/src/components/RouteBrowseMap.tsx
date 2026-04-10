'use client';

// Fix áras sofőri útvonalak térképes böngészője.
//
// Minden útvonalhoz egy zöld START marker (első waypoint) és egy piros
// CÉL marker (utolsó waypoint) + egy halvány szaggatott vonal a teljes
// waypoint sorozaton végig. Kattintásra InfoWindow az útvonal részleteivel
// (megnevezés, indulás, árak, "Részletek →" link).
//
// Saját poszt: sárga marker és sárga vonal, a részletek link pedig a
// sofőri nézetre visz (szerkeszthető), nem a foglalás oldalra.
import { Fragment, useEffect, useMemo, useRef, useState } from 'react';
import { GoogleMap, InfoWindow, Marker, Polyline, useJsApiLoader } from '@react-google-maps/api';
import Link from 'next/link';
import { CarrierRoute } from '@/api';
import { GOOGLE_MAPS_ID, GOOGLE_MAPS_LIBRARIES, getGoogleMapsApiKey } from '@/lib/maps';

const containerStyle = { width: '100%', height: '560px', borderRadius: '12px' };
const HUNGARY_CENTER = { lat: 47.1625, lng: 19.5033 };

type Props = {
  routes: CarrierRoute[];
  currentUserId?: string | null;
};

export default function RouteBrowseMap({ routes, currentUserId }: Props) {
  const apiKey = getGoogleMapsApiKey();
  const { isLoaded } = useJsApiLoader({
    googleMapsApiKey: apiKey,
    id: GOOGLE_MAPS_ID,
    libraries: GOOGLE_MAPS_LIBRARIES,
  });
  const mapRef = useRef<google.maps.Map | null>(null);
  const [activeRouteId, setActiveRouteId] = useState<string | null>(null);

  const activeRoute = useMemo(
    () => routes.find((r) => r.id === activeRouteId) || null,
    [routes, activeRouteId],
  );

  useEffect(() => {
    if (!mapRef.current || !isLoaded || routes.length === 0) return;
    const bounds = new google.maps.LatLngBounds();
    routes.forEach((r) => {
      r.waypoints.forEach((w) => bounds.extend({ lat: w.lat, lng: w.lng }));
    });
    mapRef.current.fitBounds(bounds, 80);
  }, [isLoaded, routes]);

  if (!apiKey) {
    return (
      <div className="card" style={{ background: '#fef3c7' }}>
        <strong>⚠️ Google Maps API kulcs hiányzik.</strong>
      </div>
    );
  }
  if (!isLoaded) {
    return <div className="card">Térkép betöltése…</div>;
  }

  return (
    <GoogleMap
      mapContainerStyle={containerStyle}
      center={HUNGARY_CENTER}
      zoom={7}
      onLoad={(m) => {
        mapRef.current = m;
      }}
      options={{
        streetViewControl: false,
        mapTypeControl: false,
        fullscreenControl: true,
      }}
    >
      {routes.map((r) => {
        const isMine = !!currentUserId && r.carrier_id === currentUserId;
        const first = r.waypoints[0];
        const last = r.waypoints[r.waypoints.length - 1];
        if (!first || !last) return null;

        return (
          <Fragment key={r.id}>
            {/* Halvány szaggatott vonal a teljes waypoint lánc mentén */}
            <Polyline
              path={r.waypoints.map((w) => ({ lat: w.lat, lng: w.lng }))}
              onClick={() => setActiveRouteId(r.id)}
              options={{
                strokeColor: isMine ? '#facc15' : '#1e40af',
                strokeOpacity: 0,
                strokeWeight: 3,
                icons: [
                  {
                    icon: {
                      path: 'M 0,-1 0,1',
                      strokeOpacity: 0.6,
                      scale: 3,
                    },
                    offset: '0',
                    repeat: '10px',
                  },
                ],
              }}
            />
            {/* Indulás marker */}
            <Marker
              position={{ lat: first.lat, lng: first.lng }}
              onClick={() => setActiveRouteId(r.id)}
              icon={{
                path: google.maps.SymbolPath.CIRCLE,
                scale: 10,
                fillColor: isMine ? '#facc15' : '#16a34a',
                fillOpacity: 1,
                strokeColor: '#fff',
                strokeWeight: 2,
              }}
              title={`${r.title} – indulás`}
            />
            {/* Cél marker */}
            <Marker
              position={{ lat: last.lat, lng: last.lng }}
              onClick={() => setActiveRouteId(r.id)}
              icon={{
                path: google.maps.SymbolPath.CIRCLE,
                scale: 7,
                fillColor: '#dc2626',
                fillOpacity: 0.85,
                strokeColor: '#fff',
                strokeWeight: 1.5,
              }}
              title={`${r.title} – cél`}
            />
          </Fragment>
        );
      })}

      {activeRoute && activeRoute.waypoints[0] && (
        <InfoWindow
          position={{
            lat: activeRoute.waypoints[0].lat,
            lng: activeRoute.waypoints[0].lng,
          }}
          onCloseClick={() => setActiveRouteId(null)}
        >
          <div style={{ minWidth: 240, fontFamily: 'inherit' }}>
            <div style={{ display: 'flex', gap: 6, alignItems: 'center', marginBottom: 4 }}>
              <strong style={{ fontSize: 15 }}>{activeRoute.title}</strong>
              {currentUserId && activeRoute.carrier_id === currentUserId && (
                <span
                  style={{
                    background: '#facc15',
                    color: '#713f12',
                    padding: '1px 6px',
                    borderRadius: 999,
                    fontSize: 9,
                    fontWeight: 800,
                  }}
                >
                  SAJÁT
                </span>
              )}
            </div>
            <div style={{ fontSize: 12, color: '#475569', margin: '2px 0' }}>
              📍 {activeRoute.waypoints.map((w) => w.name).join(' → ')}
            </div>
            <div style={{ fontSize: 12, color: '#475569', margin: '2px 0' }}>
              🗓 {new Date(activeRoute.departure_at).toLocaleString('hu-HU')}
            </div>
            <div
              style={{
                display: 'flex',
                gap: 4,
                flexWrap: 'wrap',
                margin: '6px 0',
              }}
            >
              {activeRoute.prices.map((p) => (
                <span
                  key={p.size}
                  style={{
                    background: 'var(--surface)',
                    padding: '2px 6px',
                    borderRadius: 999,
                    fontSize: 11,
                  }}
                >
                  <strong>{p.size}</strong> {p.price_huf.toLocaleString('hu-HU')} Ft
                </span>
              ))}
            </div>
            <Link
              href={
                currentUserId && activeRoute.carrier_id === currentUserId
                  ? `/sofor/utvonal/${activeRoute.id}`
                  : `/dashboard/utvonal/${activeRoute.id}`
              }
              style={{
                display: 'inline-block',
                background: '#1e40af',
                color: '#fff',
                padding: '6px 12px',
                borderRadius: 6,
                textDecoration: 'none',
                fontSize: 12,
                fontWeight: 600,
                marginTop: 4,
              }}
            >
              Részletek →
            </Link>
          </div>
        </InfoWindow>
      )}
    </GoogleMap>
  );
}
