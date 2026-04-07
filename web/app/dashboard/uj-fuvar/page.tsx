'use client';

// Új fuvar feladása – feladói űrlap.
// MEGJEGYZÉS: A pickup/dropoff koordinátákat egyelőre kézzel adjuk meg.
// Production-ben Google Places Autocomplete + Geocoding hívás cseréli le.
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { api } from '@/api';

export default function UjFuvar() {
  const router = useRouter();
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [form, setForm] = useState({
    title: 'Költöztetés Budapest → Debrecen',
    description: '2 szobás lakás bútorai',
    pickup_address: 'Budapest, Deák Ferenc tér 1.',
    pickup_lat: 47.4979,
    pickup_lng: 19.054,
    dropoff_address: 'Debrecen, Piac utca 20.',
    dropoff_lat: 47.5316,
    dropoff_lng: 21.6273,
    weight_kg: 350,
    volume_m3: 8,
    suggested_price_huf: 65000,
  });

  function update<K extends keyof typeof form>(key: K, value: (typeof form)[K]) {
    setForm({ ...form, [key]: value });
  }

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    setError(null);
    try {
      const job = await api.createJob(form);
      router.push(`/dashboard?created=${job.id}`);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div style={{ maxWidth: 720 }}>
      <h1>Új fuvar feladása</h1>
      <p className="muted">Add meg a fuvar adatait. Az AI automatikusan ellenőrzi a leírást.</p>

      <form className="card" onSubmit={onSubmit}>
        <label>Megnevezés</label>
        <input className="input" value={form.title} onChange={(e) => update('title', e.target.value)} required />

        <label>Részletes leírás</label>
        <textarea className="input" rows={3} value={form.description} onChange={(e) => update('description', e.target.value)} />

        <h2 style={{ marginTop: 24 }}>Felvétel</h2>
        <label>Cím</label>
        <input className="input" value={form.pickup_address} onChange={(e) => update('pickup_address', e.target.value)} required />
        <div className="grid-2">
          <div>
            <label>Szélesség (lat)</label>
            <input className="input" type="number" step="0.0001" value={form.pickup_lat}
              onChange={(e) => update('pickup_lat', parseFloat(e.target.value))} required />
          </div>
          <div>
            <label>Hosszúság (lng)</label>
            <input className="input" type="number" step="0.0001" value={form.pickup_lng}
              onChange={(e) => update('pickup_lng', parseFloat(e.target.value))} required />
          </div>
        </div>

        <h2 style={{ marginTop: 24 }}>Lerakodás</h2>
        <label>Cím</label>
        <input className="input" value={form.dropoff_address} onChange={(e) => update('dropoff_address', e.target.value)} required />
        <div className="grid-2">
          <div>
            <label>Szélesség (lat)</label>
            <input className="input" type="number" step="0.0001" value={form.dropoff_lat}
              onChange={(e) => update('dropoff_lat', parseFloat(e.target.value))} required />
          </div>
          <div>
            <label>Hosszúság (lng)</label>
            <input className="input" type="number" step="0.0001" value={form.dropoff_lng}
              onChange={(e) => update('dropoff_lng', parseFloat(e.target.value))} required />
          </div>
        </div>

        <h2 style={{ marginTop: 24 }}>Áru paraméterek</h2>
        <div className="grid-2">
          <div>
            <label>Súly (kg)</label>
            <input className="input" type="number" value={form.weight_kg}
              onChange={(e) => update('weight_kg', parseInt(e.target.value, 10))} />
          </div>
          <div>
            <label>Térfogat (m³)</label>
            <input className="input" type="number" step="0.1" value={form.volume_m3}
              onChange={(e) => update('volume_m3', parseFloat(e.target.value))} />
          </div>
        </div>
        <label>Javasolt fuvardíj (Ft)</label>
        <input className="input" type="number" value={form.suggested_price_huf}
          onChange={(e) => update('suggested_price_huf', parseInt(e.target.value, 10))} required />

        {error && <p style={{ color: 'var(--danger)' }}>{error}</p>}
        <button className="btn" type="submit" disabled={submitting} style={{ marginTop: 24 }}>
          {submitting ? 'Feladás...' : 'Fuvar feladása'}
        </button>
      </form>
    </div>
  );
}
