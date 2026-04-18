'use client';

// =====================================================================
//  Ár-kalkulátor — regisztráció nélkül elérhető a landing oldalon.
//
//  A látogató beírja: honnan, hova, mekkora csomag → kap egy becsült
//  ársávot. Ez a konverzió-optimalizálás: aki árat lát, az regisztrál.
// =====================================================================

import { useState } from 'react';
import { api } from '@/api';
import AddressAutocomplete from './AddressAutocomplete';

type Result = {
  distance_km: number;
  estimate_huf: number;
  range_low_huf: number;
  range_high_huf: number;
};

export default function PriceCalculator() {
  const [pickupAddr, setPickupAddr] = useState('');
  const [pickupCoords, setPickupCoords] = useState<{ lat: number; lng: number } | null>(null);
  const [dropoffAddr, setDropoffAddr] = useState('');
  const [dropoffCoords, setDropoffCoords] = useState<{ lat: number; lng: number } | null>(null);
  const [weightKg, setWeightKg] = useState('');
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<Result | null>(null);
  const [error, setError] = useState('');

  async function calculate() {
    if (!pickupCoords || !dropoffCoords) {
      setError('Válassz ki mindkét címet a legördülő listából.');
      return;
    }
    setLoading(true);
    setError('');
    setResult(null);
    try {
      const res = await api.priceEstimate({
        pickup_lat: pickupCoords.lat,
        pickup_lng: pickupCoords.lng,
        dropoff_lat: dropoffCoords.lat,
        dropoff_lng: dropoffCoords.lng,
        weight_kg: Number(weightKg) || undefined,
      });
      setResult(res);
    } catch {
      setError('Nem sikerült kiszámolni. Próbáld újra.');
    } finally {
      setLoading(false);
    }
  }

  const fmt = (n: number) => n.toLocaleString('hu-HU');

  return (
    <section
      style={{
        padding: '48px 20px',
        background: 'rgba(255,255,255,0.03)',
        borderTop: '1px solid var(--border)',
        borderBottom: '1px solid var(--border)',
      }}
    >
      <div style={{ maxWidth: 600, margin: '0 auto' }}>
        <h2
          style={{
            textAlign: 'center',
            fontSize: 24,
            fontWeight: 800,
            marginBottom: 8,
          }}
        >
          Mennyibe kerül a fuvarod?
        </h2>
        <p
          className="muted"
          style={{ textAlign: 'center', marginBottom: 24, fontSize: 14 }}
        >
          Számold ki regisztráció nélkül — 10 másodperc.
        </p>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          <AddressAutocomplete
            label="Honnan?"
            value={pickupAddr}
            onChange={(addr, lat, lng) => {
              setPickupAddr(addr);
              setPickupCoords({ lat, lng });
            }}
            onTextChange={(t) => {
              setPickupAddr(t);
              setPickupCoords(null);
            }}
          />
          <AddressAutocomplete
            label="Hova?"
            value={dropoffAddr}
            onChange={(addr, lat, lng) => {
              setDropoffAddr(addr);
              setDropoffCoords({ lat, lng });
            }}
            onTextChange={(t) => {
              setDropoffAddr(t);
              setDropoffCoords(null);
            }}
          />
          <div>
            <label style={{ fontSize: 13 }}>Kb. súly (kg) — opcionális</label>
            <input
              className="input"
              type="number"
              min={1}
              value={weightKg}
              onChange={(e) => setWeightKg(e.target.value)}
              placeholder="pl. 15"
            />
          </div>
          <button
            className="btn"
            type="button"
            onClick={calculate}
            disabled={loading}
            style={{ fontSize: 15, padding: '12px 24px' }}
          >
            {loading ? 'Számolás…' : 'Mutasd az árat!'}
          </button>
        </div>

        {error && (
          <p style={{ color: 'var(--danger)', marginTop: 12, textAlign: 'center' }}>
            {error}
          </p>
        )}

        {result && (
          <div
            style={{
              marginTop: 20,
              padding: 20,
              borderRadius: 12,
              background: 'rgba(46,125,50,0.1)',
              border: '2px solid #2E7D32',
              textAlign: 'center',
            }}
          >
            <div style={{ fontSize: 14, marginBottom: 8 }}>
              Becsült távolság: <strong>{result.distance_km} km</strong>
            </div>
            <div style={{ fontSize: 32, fontWeight: 800 }}>
              {fmt(result.range_low_huf)} – {fmt(result.range_high_huf)} Ft
            </div>
            <div style={{ fontSize: 14, marginTop: 4 }}>
              Legvalószínűbb: <strong>{fmt(result.estimate_huf)} Ft</strong>
            </div>
            <p className="muted" style={{ fontSize: 12, marginTop: 12, marginBottom: 0 }}>
              A tényleges ár a sofőrök licitjeitől függ. Regisztrálj, add fel a
              fuvart, és perceken belül érkeznek az ajánlatok!
            </p>
            <a
              href="/bejelentkezes"
              className="btn"
              style={{
                marginTop: 16,
                display: 'inline-block',
                textDecoration: 'none',
                background: '#2E7D32',
                fontSize: 14,
                padding: '10px 24px',
              }}
            >
              Regisztrálok és feladok egy fuvart
            </a>
          </div>
        )}
      </div>
    </section>
  );
}
