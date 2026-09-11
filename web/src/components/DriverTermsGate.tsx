'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { api } from '@/api';
import { useCurrentUser, writeStoredMode } from '@/lib/auth';
import { optionalPhoneError } from '@/lib/formValidation';

/**
 * Szállítói egyszeri nyilatkozat-kapu. A szállító-mód első használatakor a
 * felhasználónak el kell fogadnia, hogy minden vonatkozó jogszabályt és a
 * KRESZ-t betartja. Elfogadás után (driver_terms_accepted_at rögzül) többé
 * nem jelenik meg. A backend (requireDriverKYC) is megköveteli, tehát
 * enélkül nem lehet licitálni / útvonalat hirdetni.
 *
 * 2026-09-11 (teljes audit B1):
 *  - TELEFONSZÁM: ha a profilban nincs, itt kérjük — a feladó a díj után
 *    ezen éri el a szállítót (a backend PHONE_REQUIRED-del zár enélkül).
 *  - MÉGSE / ESC: eddig a modal csapda volt (se bezárás, se kiút) — most
 *    visszavált feladó módba és a főoldalra visz.
 */
export default function DriverTermsGate() {
  const user = useCurrentUser();
  const router = useRouter();
  const [needsAccept, setNeedsAccept] = useState(false);
  const [needsPhone, setNeedsPhone] = useState(false);
  const [phone, setPhone] = useState('');
  const [checked, setChecked] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!user) return;
    let alive = true;
    api.getMyProfile()
      .then((p) => {
        if (!alive) return;
        if (!p?.driver_terms_accepted_at) setNeedsAccept(true);
        if (!p?.phone) setNeedsPhone(true);
      })
      .catch(() => {});
    return () => { alive = false; };
  }, [user]);

  function megse() {
    writeStoredMode('shipper');
    setNeedsAccept(false);
    router.push('/');
  }

  useEffect(() => {
    if (!needsAccept) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') megse(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [needsAccept]);

  if (!needsAccept) return null;

  const phoneHiba = needsPhone ? (phone.trim() ? optionalPhoneError(phone) : 'Add meg a telefonszámod — a feladó ezen ér el.') : null;

  async function accept() {
    if (!checked || phoneHiba) return;
    setSaving(true);
    setError(null);
    try {
      if (needsPhone) await api.updateMyProfile({ phone: phone.trim() });
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
      aria-labelledby="driver-terms-cim"
    >
      <div className="card" style={{ maxWidth: 500, marginBottom: 0 }}>
        <h2 id="driver-terms-cim" style={{ marginTop: 0 }}>🚦 Mielőtt fuvarozol</h2>
        <p style={{ color: 'var(--text)', lineHeight: 1.6 }}>
          A GoFuvar közvetítő platform: a fuvarozási szerződés közvetlenül közted és a
          feladó között jön létre. Mielőtt fuvart vállalsz, kérjük, erősítsd meg az alábbit.
        </p>
        {needsPhone && (
          <div style={{ margin: '12px 0' }}>
            <label htmlFor="driver-terms-telefon" style={{ display: 'block', fontSize: 13, fontWeight: 600, marginBottom: 4 }}>
              Telefonszám <span className="muted" style={{ fontWeight: 400 }}>— a feladó a díj kifizetése után ezen ér el</span>
            </label>
            <input
              id="driver-terms-telefon"
              type="tel"
              inputMode="tel"
              autoComplete="tel"
              placeholder="+36 20 123 4567"
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
              aria-invalid={!!(phone.trim() && phoneHiba)}
            />
            {phone.trim() && phoneHiba && (
              <p role="alert" style={{ color: 'var(--danger-text)', fontSize: 13, margin: '4px 0 0' }}>{phoneHiba}</p>
            )}
          </div>
        )}
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
        {error && <p role="alert" style={{ color: 'var(--danger-text)', fontSize: 13, margin: '0 0 8px' }}>{error}</p>}
        <button className="btn" onClick={accept} disabled={!checked || !!phoneHiba || saving} style={{ width: '100%' }}>
          {saving ? 'Mentés…' : 'Elfogadom és folytatom'}
        </button>
        <button type="button" className="btn btn-ghost" onClick={megse} style={{ width: '100%', marginTop: 8 }}>
          Mégse — maradok feladó
        </button>
      </div>
    </div>
  );
}
