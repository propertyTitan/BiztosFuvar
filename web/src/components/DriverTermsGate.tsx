'use client';

import { useEffect, useState } from 'react';
import { api } from '@/api';
import { useCurrentUser } from '@/lib/auth';

/**
 * Sofőri egyszeri nyilatkozat-kapu. A sofőr-mód első használatakor a
 * felhasználónak el kell fogadnia, hogy minden vonatkozó jogszabályt és a
 * KRESZ-t betartja. Elfogadás után (driver_terms_accepted_at rögzül) többé
 * nem jelenik meg. A backend (requireDriverKYC) is megköveteli, tehát
 * enélkül nem lehet licitálni / útvonalat hirdetni.
 */
export default function DriverTermsGate() {
  const user = useCurrentUser();
  const [needsAccept, setNeedsAccept] = useState(false);
  const [checked, setChecked] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!user) return;
    let alive = true;
    api.getMyProfile()
      .then((p) => { if (alive && !p?.driver_terms_accepted_at) setNeedsAccept(true); })
      .catch(() => {});
    return () => { alive = false; };
  }, [user]);

  if (!needsAccept) return null;

  async function accept() {
    if (!checked) return;
    setSaving(true);
    setError(null);
    try {
      await api.acceptDriverTerms();
      setNeedsAccept(false);
    } catch (e: any) {
      setError(e?.message || 'Nem sikerült elmenteni. Próbáld újra.');
    } finally {
      setSaving(false);
    }
  }

  return (
    <div
      style={{
        position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.55)', zIndex: 1000,
        display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16,
      }}
      role="dialog"
      aria-modal="true"
    >
      <div className="card" style={{ maxWidth: 500, marginBottom: 0 }}>
        <h2 style={{ marginTop: 0 }}>🚦 Mielőtt fuvarozol</h2>
        <p style={{ color: 'var(--text)', lineHeight: 1.6 }}>
          A GoFuvar közvetítő platform: a fuvarozási szerződés közvetlenül közted és a
          feladó között jön létre. Mielőtt fuvart vállalsz, kérjük, erősítsd meg az alábbit.
        </p>
        <label
          style={{
            display: 'flex', gap: 10, alignItems: 'flex-start', margin: '16px 0',
            fontSize: 14, lineHeight: 1.55, cursor: 'pointer',
          }}
        >
          <input
            type="checkbox"
            checked={checked}
            onChange={(e) => setChecked(e.target.checked)}
            style={{ marginTop: 3, flexShrink: 0, width: 18, height: 18 }}
          />
          <span>
            Kijelentem, hogy a fuvarozás során <strong>minden vonatkozó jogszabályt és a
            KRESZ szabályait betartom</strong>, a járművem/eszközöm szabályos és
            közlekedésre alkalmas, és rendelkezem a tevékenységhez szükséges
            engedélyekkel. Tudomásul veszem, hogy ezekért én felelek.
          </span>
        </label>
        {error && <p style={{ color: 'var(--danger-text)', fontSize: 13, margin: '0 0 8px' }}>{error}</p>}
        <button className="btn" onClick={accept} disabled={!checked || saving} style={{ width: '100%' }}>
          {saving ? 'Mentés…' : 'Elfogadom és folytatom'}
        </button>
      </div>
    </div>
  );
}
