'use client';

// =====================================================================
//  LiveTrackingMap – Google Maps + Socket.IO élő követés
//  - Kék „A" jelölő: felvételi pont
//  - Zöld „B" jelölő: lerakodási pont
//  - PIROS PÖTTY: a szállító aktuális helyzete (real-time mozog)
//  - Útvonal: pickup → driver → dropoff polyline
//
//  2026-10-08 (UX-átvizsgálás A17):
//   - a ráközelítés az onLoad-ban is fut (eddig a térkép-példány még nem
//     létezett, amikor az effect lefutott → 7-es nagyítás maradt);
//   - az utolsó pozíciót CSAK úton lévő fuvarnál és CSAK a felek kérik
//     (a nem érintett szállítónál 403 + konzolhiba volt);
//   - a magasság a képernyőhöz igazodik: min(480px, 45vh), a feladói
//     nézet alacsonyabbat kér (`magassag` prop).
// =====================================================================
import { useEffect, useMemo, useRef, useState } from 'react';
import { useCurrentUser } from '@/lib/auth';
import { illesztesPontokra } from '@/lib/terkepIllesztes';
import { GoogleMap, Marker, Polyline, useJsApiLoader } from '@react-google-maps/api';
import { subscribeJob } from '@/lib/socket';
import { api, Job } from '@/api';
import { GOOGLE_MAPS_ID, GOOGLE_MAPS_LIBRARIES, getGoogleMapsApiKey, GOOGLE_MAPS_LANGUAGE, GOOGLE_MAPS_REGION } from '@/lib/maps';

type Props = {
  job: Job;
  /** A térkép magassága (CSS). Alap: a képernyő 45%-a, legfeljebb 480 px. */
  magassag?: string;
};

export default function LiveTrackingMap({ job, magassag = 'min(480px, 45vh)' }: Props) {
  const me = useCurrentUser();
  const containerStyle = useMemo(() => ({ width: '100%', height: magassag, borderRadius: '12px' }), [magassag]);
  // Élő pozíció csak úton (a vita alatt a fizikai állapot számít), és csak
  // a feleknek jár — más nézőnél a kérés 403 lenne.
  const fizikai = job.status === 'disputed' ? job.status_before_dispute : job.status;
  const fel = !!me && (me.id === job.shipper_id || (!!job.carrier_id && me.id === job.carrier_id));
  const poziciotKer = fel && fizikai === 'in_progress';
  const apiKey = getGoogleMapsApiKey();
  const { isLoaded, loadError } = useJsApiLoader({
    googleMapsApiKey: apiKey,
    id: GOOGLE_MAPS_ID,
    libraries: GOOGLE_MAPS_LIBRARIES,
    language: GOOGLE_MAPS_LANGUAGE,
    region: GOOGLE_MAPS_REGION,
  });

  const [driver, setDriver] = useState<{ lat: number; lng: number } | null>(null);
  const [speed, setSpeed] = useState<number | null>(null);
  const [trail, setTrail] = useState<Array<{ lat: number; lng: number }>>([]);
  const [updatedAt, setUpdatedAt] = useState<Date | null>(null);
  const mapRef = useRef<google.maps.Map | null>(null);

  const TRAIL_MAX = 30; // utolsó 30 pozíciót tartjuk meg vizuális nyomvonalként

  // 1) Kezdeti pozíció lekérése REST-en, aztán Socket.IO real-time
  useEffect(() => {
    if (!poziciotKer) return;
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
  }, [job.id, poziciotKer]);

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

  // Útvonal polyline – ha tudjuk a szállító pozícióját, beszúrjuk középre
  const path = useMemo(() => {
    const points = [{ lat: job.pickup_lat, lng: job.pickup_lng }];
    if (driver) points.push(driver);
    points.push({ lat: job.dropoff_lat, lng: job.dropoff_lng });
    return points;
  }, [job, driver]);

  // Térkép automatikus zoomolása az összes pontra — a pontok változásakor
  // (a térkép első betöltésekor az onLoad illeszt, lásd lent).
  useEffect(() => {
    if (!isLoaded) return;
    illesztesPontokra(mapRef.current, path);
  }, [isLoaded, path]);

  if (!apiKey) {
    return (
      <div className="card" style={{ background: 'var(--warning-light)' }}>
        <strong>⚠️ Google Maps API kulcs hiányzik.</strong>
        <p className="muted" style={{ margin: '8px 0 0' }}>
          Állítsd be a <code>NEXT_PUBLIC_GOOGLE_MAPS_KEY</code> környezeti változót,
          hogy lásd a térképet.
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
        onLoad={(m) => { mapRef.current = m; illesztesPontokra(m, path); }}
        options={{
          streetViewControl: false,
          mapTypeControl: false,
          fullscreenControl: false,
        }}
      >
        {/* Felvételi pont – kék „A" */}
        <Marker
          position={{ lat: job.pickup_lat, lng: job.pickup_lng }}
          label={{ text: 'A', color: '#fff', fontWeight: '700' }}
          icon={{
            path: google.maps.SymbolPath.CIRCLE,
            scale: 14,
            fillColor: '#2563eb' /* Google Maps API: CSS-var NEM megy, csak literál hex! */,
            fillOpacity: 1,
            strokeColor: '#fff',
            strokeWeight: 2,
          }}
          title={`Felvétel: ${job.pickup_address}`}
        />
        {/* Lerakodási pont – zöld „B" (a piros a szállító élő pöttyéé) */}
        <Marker
          position={{ lat: job.dropoff_lat, lng: job.dropoff_lng }}
          label={{ text: 'B', color: '#fff', fontWeight: '700' }}
          icon={{
            path: google.maps.SymbolPath.CIRCLE,
            scale: 14,
            fillColor: '#16a34a',
            fillOpacity: 1,
            strokeColor: '#fff',
            strokeWeight: 2,
          }}
          title={`Lerakodás: ${job.dropoff_address}`}
        />
        {/* SZÁLLÍTÓ – piros pötty (real-time) */}
        {driver && (
          <Marker
            position={driver}
            zIndex={999}
            icon={{
              path: google.maps.SymbolPath.CIRCLE,
              scale: 10,
              fillColor: '#dc2626',
              fillOpacity: 1,
              strokeColor: '#fff',
              strokeWeight: 3,
            }}
            title="Szállító aktuális pozíciója"
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
        {/* Szállító nyomvonala – az utolsó N ping pirosan */}
        {trail.length > 1 && (
          <Polyline
            path={trail}
            options={{
              strokeColor: '#dc2626',
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
          border: `1px solid ${driver ? 'var(--success)' : 'var(--border)'}`,
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          flexWrap: 'wrap',
          gap: 8,
        }}
      >
        <div>
          <span className="pill pill-progress" style={{ marginRight: 8 }}>
            {driver ? '🔴 Élő követés aktív' : 'Élő GPS-követés hamarosan — a GoFuvar mobilapp érkezésével'}
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
              background: 'var(--success-strong)', color: '#fff',
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
