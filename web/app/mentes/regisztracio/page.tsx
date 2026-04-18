'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { api } from '@/api';
import { useCurrentUser } from '@/lib/auth';

const SERVICES = [
  { id: 'flat_tire', icon: '🛞', label: 'Defekt / mobilgumis' },
  { id: 'breakdown', icon: '🔧', label: 'Lerobbanás / vontatás' },
  { id: 'battery',   icon: '🔋', label: 'Akkumulátor / begyújtás' },
  { id: 'ditch',     icon: '🏔️', label: 'Elakadás / kihúzás' },
  { id: 'accident',  icon: '💥', label: 'Baleset utáni mentés' },
  { id: 'lockout',   icon: '🔑', label: 'Zárnyitás' },
  { id: 'fuel',      icon: '⛽', label: 'Üzemanyag szállítás' },
] as const;

export default function MentosRegisztracio() {
  const me = useCurrentUser();
  const router = useRouter();
  const [selected, setSelected] = useState<string[]>([]);
  const [vehicle, setVehicle] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');

  function toggle(id: string) {
    setSelected((prev) =>
      prev.includes(id) ? prev.filter((s) => s !== id) : [...prev, id],
    );
  }

  async function submit() {
    if (selected.length === 0) {
      setError('Válassz ki legalább egy szolgáltatást.');
      return;
    }
    setSubmitting(true);
    setError('');
    try {
      await api.registerTowDriver({
        tow_services: selected,
        tow_vehicle_description: vehicle || undefined,
      });
      router.push('/mentes/beerkezett');
    } catch (err: any) {
      setError(err.message);
    } finally {
      setSubmitting(false);
    }
  }

  if (!me) return <p>Bejelentkezés szükséges.</p>;

  return (
    <div style={{ maxWidth: 600, margin: '0 auto' }}>
      <h1>🚗 Mentős regisztráció</h1>
      <p className="muted">
        Regisztrálj autómentősként / mobilgumisként, és a bajba jutott
        autósok push értesítést kapnak rólad, ha a közelükben vagy.
      </p>

      <div className="card">
        <h2 style={{ marginTop: 0 }}>Milyen szolgáltatást vállalsz?</h2>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {SERVICES.map((s) => (
            <label
              key={s.id}
              style={{
                display: 'flex', gap: 12, alignItems: 'center', cursor: 'pointer',
                padding: '10px 14px', borderRadius: 8,
                background: selected.includes(s.id) ? 'rgba(46,125,50,0.1)' : 'transparent',
                border: `1px solid ${selected.includes(s.id) ? '#2E7D32' : 'var(--border)'}`,
              }}
            >
              <input
                type="checkbox"
                checked={selected.includes(s.id)}
                onChange={() => toggle(s.id)}
                style={{ width: 20, height: 20 }}
              />
              <span style={{ fontSize: 22 }}>{s.icon}</span>
              <span style={{ fontWeight: 600 }}>{s.label}</span>
            </label>
          ))}
        </div>

        <label style={{ marginTop: 20, display: 'block' }}>Jármű / felszerelés leírása</label>
        <textarea
          className="input"
          rows={2}
          value={vehicle}
          onChange={(e) => setVehicle(e.target.value)}
          placeholder="pl. Ford Transit platós, hidraulikus emelővel, mobilgumi készlet"
        />

        {error && <p style={{ color: '#EF4444', marginTop: 12 }}>{error}</p>}

        <button
          className="btn"
          type="button"
          onClick={submit}
          disabled={submitting}
          style={{ marginTop: 20, width: '100%', fontSize: 16, padding: '14px 24px' }}
        >
          {submitting ? 'Regisztráció…' : 'Mentősként regisztrálok'}
        </button>
      </div>
    </div>
  );
}
