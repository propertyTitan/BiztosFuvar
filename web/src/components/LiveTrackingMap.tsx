'use client';

// =====================================================================
//  LiveTrackingMap – Google Maps + Socket.IO élő követés
//  - Zöld marker: felvételi pont
//  - Piros marker: lerakodási pont
//  - PIROS PÖTTY: a sofőr aktuális helyzete (real-time mozog)
//  - Útvonal: pickup → driver → dropoff polyline
// =====================================================================
import { useEffect, useMemo, useRef, useState } from 'react';
import { GoogleMap, Marker, Polyline, useJsApiLoader } from '@react-google-maps/api';
import { subscribeJob } from '@/lib/socket';
import { api, Job } from '@/api';
import { GOOGLE_MAPS_ID, GOOGLE_MAPS_LIBRARIES, getGoogleMapsApiKey } from '@/lib/maps';

type Props = { job: Job };

const containerStyle = { width: '100%', height: '480px', borderRadius: '12px' };

export default function LiveTrackingMap({ job }: Props) {
  const apiKey = getGoogleMapsApiKey();
  const { isLoaded, loadError } = useJsApiLoader({
    googleMapsApiKey: apiKey,
    id: GOOGLE_MAPS_ID,
    libraries: GOOGLE_MAPS_LIBRARIES,
  });

  const [driver, setDriver] = useState<{ lat: number; lng: number } | null>(null);
  const [speed, setSpeed] = useState<number | null>(null);
  const [trail, setTrail] = useState<Array<{ lat: number; lng: number }>>([]);
  const [updatedAt, setUpdatedAt] = useState<Date | null>(null);
  const mapRef = useRef<google.maps.Map | null>(null);

  const TRAIL_MAX = 30; // utolsó 30 pozíciót tartjuk meg vizuális nyomvonalként

  // 1) Kezdeti pozíció lekérése REST-en, aztán Socket.IO real-time
  useEffect(() => {
    let active = true;
    api.lastLocation(job.id)
      .then((loc) => {
        if (active && loc) {
          const p = { lat: loc.lat, lng: loc.lng };
          setDriver(p);
          setTrail([p]);
          setUpdatedAt(new Date(loc.recorded_at));
        }
      })
      .catch(() => {});
    return () => { active = false; };
  }, [job.id]);

  useEffect(() => {
    const unsub = subscribeJob(job.id, {
      onTrackingPing: (p) => {
        const point = { lat: p.lat, lng: p.lng };
        setDriver(point);
        if (p.speed_kmh) setSpeed(p.speed_kmh);
        setTrail((prev) => [...prev, point].slice(-TRAIL_MAX));
        setUpdatedAt(new Date());
      },
    });
    return unsub;
  }, [job.id]);

  const center = useMemo(
    () => ({
      lat: (job.pickup_lat + job.dropoff_lat) / 2,
      lng: (job.pickup_lng + job.dropoff_lng) / 2,
    }),
    [job],
  );

  // Útvonal polyline – ha tudjuk a sofőr pozícióját, beszúrjuk középre
  const path = useMemo(() => {
    const points = [{ lat: job.pickup_lat, lng: job.pickup_lng }];
    if (driver) points.push(driver);
    points.push({ lat: job.dropoff_lat, lng: job.dropoff_lng });
    return points;
  }, [job, driver]);

  // Térkép automatikus zoomolása az összes pontra
  useEffect(() => {
    if (!mapRef.current || !isLoaded) return;
    const bounds = new google.maps.LatLngBounds();
    path.forEach((p) => bounds.extend(p));
    mapRef.current.fitBounds(bounds, 64);
  }, [isLoaded, path]);

  if (!apiKey) {
    return (
      <div className="card" style={{ background: '#fef3c7' }}>
        <strong>⚠️ Google Maps API kulcs hiányzik.</strong>
        <p className="muted" style={{ margin: '8px 0 0' }}>
          Állítsd be a <code>NEXT_PUBLIC_GOOGLE_MAPS_KEY</code> környezeti változót,
          hogy lásd a térképet és az élő követést.
        </p>
      </div>
    );
  }
  if (loadError) return <div className="card">Hiba a Google Maps betöltésekor.</div>;
  if (!isLoaded) return <div className="card">Térkép betöltése…</div>;

  return (
    <div>
      <GoogleMap
        mapContainerStyle={containerStyle}
        center={center}
        zoom={7}
        onLoad={(m) => { mapRef.current = m; }}
        options={{
          streetViewControl: false,
          mapTypeControl: false,
          fullscreenControl: false,
        }}
      >
        {/* Felvételi pont – zöld */}
        <Marker
          position={{ lat: job.pickup_lat, lng: job.pickup_lng }}
          label={{ text: 'F', color: '#fff', fontWeight: '700' }}
          icon={{
            path: google.maps.SymbolPath.CIRCLE,
            scale: 14,
            fillColor: '#16a34a',
            fillOpacity: 1,
            strokeColor: '#fff',
            strokeWeight: 2,
          }}
          title={`Felvétel: ${job.pickup_address}`}
        />
        {/* Lerakodási pont – piros marker */}
        <Marker
          position={{ lat: job.dropoff_lat, lng: job.dropoff_lng }}
          label={{ text: 'L', color: '#fff', fontWeight: '700' }}
          icon={{
            path: google.maps.SymbolPath.CIRCLE,
            scale: 14,
            fillColor: '#dc2626',
            fillOpacity: 1,
            strokeColor: '#fff',
            strokeWeight: 2,
          }}
          title={`Lerakodás: ${job.dropoff_address}`}
        />
        {/* SOFŐR – piros pötty (real-time) */}
        {driver && (
          <Marker
            position={driver}
            zIndex={999}
            icon={{
              path: google.maps.SymbolPath.CIRCLE,
              scale: 10,
              fillColor: '#ef4444',
              fillOpacity: 1,
              strokeColor: '#fff',
              strokeWeight: 3,
            }}
            title="Sofőr aktuális pozíciója"
          />
        )}
        <Polyline
          path={path}
          options={{
            strokeColor: '#1e40af',
            strokeWeight: 4,
            strokeOpacity: 0.7,
            geodesic: true,
          }}
        />
        {/* Sofőr nyomvonala – az utolsó N ping pirosan */}
        {trail.length > 1 && (
          <Polyline
            path={trail}
            options={{
              strokeColor: '#ef4444',
              strokeWeight: 5,
              strokeOpacity: 0.9,
            }}
          />
        )}
      </GoogleMap>

      {/* ETA + status bar */}
      <div
        style={{
          marginTop: 12,
          padding: '12px 16px',
          borderRadius: 10,
          background: driver ? 'rgba(46,125,50,0.1)' : 'rgba(255,255,255,0.05)',
          border: `1px solid ${driver ? '#2E7D32' : 'var(--border)'}`,
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          flexWrap: 'wrap',
          gap: 8,
        }}
      >
        <div>
          <span className="pill pill-progress" style={{ marginRight: 8 }}>
            {driver ? '🔴 Élő követés aktív' : '⏳ Várakozás a sofőr pozíciójára'}
          </span>
          {updatedAt && (
            <span className="muted" style={{ fontSize: 12 }}>
              {updatedAt.toLocaleTimeString('hu-HU')}
              {speed ? ` · ${Math.round(speed)} km/h` : ''}
            </span>
          )}
        </div>
        {driver && (() => {
          const targetLat = job.status === 'accepted' ? job.pickup_lat : job.dropoff_lat;
          const targetLng = job.status === 'accepted' ? job.pickup_lng : job.dropoff_lng;
          const distKm = haversineKm(driver.lat, driver.lng, targetLat, targetLng);
          const avgSpeed = (speed && speed > 5) ? speed : 40;
          const mins = Math.round((distKm / avgSpeed) * 60);
          const etaText = mins <= 1 ? 'Mindjárt ott van!' : mins < 60 ? `~${mins} perc` : `~${Math.floor(mins / 60)} óra ${mins % 60} perc`;
          return (
            <div style={{
              padding: '6px 16px', borderRadius: 20,
              background: '#2E7D32', color: '#fff',
              fontWeight: 800, fontSize: 16,
            }}>
              {etaText}
            </div>
          );
        })()}
      </div>
    </div>
  );
}

function haversineKm(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const R = 6371;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLng = ((lng2 - lng1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((lat1 * Math.PI) / 180) * Math.cos((lat2 * Math.PI) / 180) *
    Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}
