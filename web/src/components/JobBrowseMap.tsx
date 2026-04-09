'use client';

// Licites fuvarok térképes böngészője.
//
// Minden fuvarhoz egy FELVÉTELI marker (zöld, vagy sárga ha saját poszt)
// és egy LERAKODÁSI marker (piros, kisebb), plusz egy halvány szaggatott
// vonal a kettő között, hogy vizuálisan is lássa a felhasználó merre
// megy a fuvar.
//
// Kattintásra egy InfoWindow jelenik meg a fuvar címével, árával, és egy
// "Részletek →" linkkel a megfelelő detail oldalra (saját poszt → feladói
// nézet, más fuvar → sofőri nézet).
import { Fragment, useEffect, useMemo, useRef, useState } from 'react';
import { GoogleMap, InfoWindow, Marker, Polyline, useJsApiLoader } from '@react-google-maps/api';
import Link from 'next/link';
import { Job } from '@/api';
import { GOOGLE_MAPS_ID, GOOGLE_MAPS_LIBRARIES, getGoogleMapsApiKey } from '@/lib/maps';

const containerStyle = { width: '100%', height: '560px', borderRadius: '12px' };
const HUNGARY_CENTER = { lat: 47.1625, lng: 19.5033 };

type Props = {
  jobs: Job[];
  currentUserId?: string | null;
};

export default function JobBrowseMap({ jobs, currentUserId }: Props) {
  const apiKey = getGoogleMapsApiKey();
  const { isLoaded } = useJsApiLoader({
    googleMapsApiKey: apiKey,
    id: GOOGLE_MAPS_ID,
    libraries: GOOGLE_MAPS_LIBRARIES,
  });
  const mapRef = useRef<google.maps.Map | null>(null);
  const [activeJobId, setActiveJobId] = useState<string | null>(null);

  // Az aktív fuvart kikeressük a listából (ha még létezik)
  const activeJob = useMemo(
    () => jobs.find((j) => j.id === activeJobId) || null,
    [jobs, activeJobId],
  );

  // Auto-fit: minden felvétel/lerakodás pontra ráközelít
  useEffect(() => {
    if (!mapRef.current || !isLoaded || jobs.length === 0) return;
    const bounds = new google.maps.LatLngBounds();
    jobs.forEach((j) => {
      bounds.extend({ lat: j.pickup_lat, lng: j.pickup_lng });
      bounds.extend({ lat: j.dropoff_lat, lng: j.dropoff_lng });
    });
    mapRef.current.fitBounds(bounds, 80);
  }, [isLoaded, jobs]);

  if (!apiKey) {
    return (
      <div className="card" style={{ background: '#fef3c7' }}>
        <strong>⚠️ Google Maps API kulcs hiányzik.</strong>
        <p className="muted" style={{ margin: '8px 0 0' }}>
          Állítsd be a <code>NEXT_PUBLIC_GOOGLE_MAPS_KEY</code> env-et a térképes nézethez.
        </p>
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
      {jobs.map((j) => {
        const isMine = !!currentUserId && j.shipper_id === currentUserId;
        return (
          <Fragment key={j.id}>
            {/* Halvány szaggatott vonal a pickup → dropoff között, hogy
                látszódjon az irány. Opacityvel hogy ne zavarjon be. */}
            <Polyline
              path={[
                { lat: j.pickup_lat, lng: j.pickup_lng },
                { lat: j.dropoff_lat, lng: j.dropoff_lng },
              ]}
              options={{
                strokeColor: isMine ? '#facc15' : '#1e40af',
                strokeOpacity: 0,
                strokeWeight: 2,
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
            <Marker
              position={{ lat: j.pickup_lat, lng: j.pickup_lng }}
              onClick={() => setActiveJobId(j.id)}
              icon={{
                path: google.maps.SymbolPath.CIRCLE,
                scale: 10,
                fillColor: isMine ? '#facc15' : '#16a34a',
                fillOpacity: 1,
                strokeColor: '#fff',
                strokeWeight: 2,
              }}
              title={isMine ? `${j.title} (saját poszt)` : j.title}
            />
            <Marker
              position={{ lat: j.dropoff_lat, lng: j.dropoff_lng }}
              onClick={() => setActiveJobId(j.id)}
              icon={{
                path: google.maps.SymbolPath.CIRCLE,
                scale: 7,
                fillColor: '#dc2626',
                fillOpacity: 0.85,
                strokeColor: '#fff',
                strokeWeight: 1.5,
              }}
              title={`${j.title} – cél`}
            />
          </Fragment>
        );
      })}

      {activeJob && (
        <InfoWindow
          position={{ lat: activeJob.pickup_lat, lng: activeJob.pickup_lng }}
          onCloseClick={() => setActiveJobId(null)}
        >
          <div style={{ minWidth: 220, fontFamily: 'inherit' }}>
            <div style={{ display: 'flex', gap: 6, alignItems: 'center', marginBottom: 4 }}>
              <strong style={{ fontSize: 15 }}>{activeJob.title}</strong>
              {currentUserId && activeJob.shipper_id === currentUserId && (
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
              📍 {activeJob.pickup_address}
            </div>
            <div style={{ fontSize: 12, color: '#475569', margin: '2px 0' }}>
              🏁 {activeJob.dropoff_address}
            </div>
            <div
              style={{
                fontSize: 15,
                fontWeight: 700,
                color: '#1e40af',
                margin: '6px 0',
              }}
            >
              {activeJob.suggested_price_huf?.toLocaleString('hu-HU')} Ft
            </div>
            <Link
              href={
                currentUserId && activeJob.shipper_id === currentUserId
                  ? `/dashboard/fuvar/${activeJob.id}`
                  : `/sofor/fuvar/${activeJob.id}`
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
