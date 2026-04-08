'use client';

// A Shipper Dashboard tetején látható nagy térkép – összes saját aktív
// fuvar markerekkel + élő követés ahhoz a fuvarhoz, amelyik 'in_progress'.
import { useEffect, useMemo, useRef, useState } from 'react';
import { GoogleMap, Marker, useJsApiLoader } from '@react-google-maps/api';
import Link from 'next/link';
import { Job } from '@/api';
import { subscribeJob } from '@/lib/socket';
import { GOOGLE_MAPS_ID, GOOGLE_MAPS_LIBRARIES, getGoogleMapsApiKey } from '@/lib/maps';

const containerStyle = { width: '100%', height: '380px', borderRadius: '12px' };

const HUNGARY_CENTER = { lat: 47.1625, lng: 19.5033 };

export default function DashboardOverviewMap({ jobs }: { jobs: Job[] }) {
  const apiKey = getGoogleMapsApiKey();
  const { isLoaded } = useJsApiLoader({
    googleMapsApiKey: apiKey,
    id: GOOGLE_MAPS_ID,
    libraries: GOOGLE_MAPS_LIBRARIES,
  });
  const mapRef = useRef<google.maps.Map | null>(null);

  // A folyamatban lévő fuvarokhoz feliratkozunk az élő pozícióra
  const liveJobs = useMemo(() => jobs.filter((j) => j.status === 'in_progress'), [jobs]);
  const [driverPositions, setDriverPositions] = useState<Record<string, { lat: number; lng: number }>>({});

  useEffect(() => {
    const unsubs = liveJobs.map((j) =>
      subscribeJob(j.id, {
        onTrackingPing: (p) =>
          setDriverPositions((prev) => ({ ...prev, [j.id]: { lat: p.lat, lng: p.lng } })),
      }),
    );
    return () => { unsubs.forEach((u) => u()); };
  }, [liveJobs]);

  // Auto-fit minden markerre
  useEffect(() => {
    if (!mapRef.current || !isLoaded || jobs.length === 0) return;
    const bounds = new google.maps.LatLngBounds();
    jobs.forEach((j) => {
      bounds.extend({ lat: j.pickup_lat, lng: j.pickup_lng });
      bounds.extend({ lat: j.dropoff_lat, lng: j.dropoff_lng });
    });
    Object.values(driverPositions).forEach((p) => bounds.extend(p));
    mapRef.current.fitBounds(bounds, 64);
  }, [isLoaded, jobs, driverPositions]);

  if (!apiKey) {
    return (
      <div className="card" style={{ background: '#fef3c7' }}>
        <strong>⚠️ Google Maps API kulcs hiányzik.</strong>
        <p className="muted" style={{ margin: '8px 0 0' }}>
          Állítsd be a <code>NEXT_PUBLIC_GOOGLE_MAPS_KEY</code> env-et a térképhez.
        </p>
      </div>
    );
  }
  if (!isLoaded) return <div className="card">Térkép betöltése…</div>;

  const liveCount = Object.keys(driverPositions).length;

  return (
    <div style={{ position: 'relative' }}>
      {liveCount > 0 && (
        <div
          style={{
            position: 'absolute',
            top: 12,
            left: 12,
            zIndex: 10,
            background: 'rgba(220, 38, 38, 0.95)',
            color: '#fff',
            padding: '6px 14px',
            borderRadius: 999,
            fontSize: 13,
            fontWeight: 700,
            boxShadow: '0 2px 6px rgba(0,0,0,0.2)',
          }}
        >
          🔴 {liveCount} sofőr élőben követve
        </div>
      )}
      <GoogleMap
      mapContainerStyle={containerStyle}
      center={HUNGARY_CENTER}
      zoom={7}
      onLoad={(m) => { mapRef.current = m; }}
      options={{ streetViewControl: false, mapTypeControl: false, fullscreenControl: false }}
    >
      {jobs.map((j) => (
        <Marker
          key={`pickup-${j.id}`}
          position={{ lat: j.pickup_lat, lng: j.pickup_lng }}
          icon={{
            path: google.maps.SymbolPath.CIRCLE,
            scale: 9, fillColor: '#16a34a', fillOpacity: 1,
            strokeColor: '#fff', strokeWeight: 2,
          }}
          title={`${j.title} – Felvétel`}
        />
      ))}
      {jobs.map((j) => (
        <Marker
          key={`dropoff-${j.id}`}
          position={{ lat: j.dropoff_lat, lng: j.dropoff_lng }}
          icon={{
            path: google.maps.SymbolPath.CIRCLE,
            scale: 9, fillColor: '#dc2626', fillOpacity: 1,
            strokeColor: '#fff', strokeWeight: 2,
          }}
          title={`${j.title} – Lerakodás`}
        />
      ))}
      {Object.entries(driverPositions).map(([jobId, p]) => (
        <Marker
          key={`driver-${jobId}`}
          position={p}
          zIndex={999}
          icon={{
            path: google.maps.SymbolPath.CIRCLE,
            scale: 11, fillColor: '#ef4444', fillOpacity: 1,
            strokeColor: '#fff', strokeWeight: 3,
          }}
          title="Sofőr (élő)"
        />
      ))}
      </GoogleMap>
    </div>
  );
}
