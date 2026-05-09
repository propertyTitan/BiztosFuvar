'use client';

// Email-megerősítés céloldal. A user a regisztrációkor kapott emailben
// erre az URL-re kattint (?token=...). Mi azonnal hívjuk a backend-et,
// ami megerősíti a fiókot.

import { useEffect, useState, Suspense } from 'react';
import { useSearchParams } from 'next/navigation';
import Link from 'next/link';
import { api } from '@/api';

function EmailMegerositeseInner() {
  const params = useSearchParams();
  const token = params.get('token') || '';
  const [state, setState] = useState<'pending' | 'ok' | 'error'>('pending');
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!token) {
      setState('error');
      setError('Hiányzó token a linkben.');
      return;
    }
    api.verifyEmail(token)
      .then(() => setState('ok'))
      .catch((e: any) => {
        setState('error');
        setError(e.message);
      });
  }, [token]);

  return (
    <div style={{ maxWidth: 440, margin: '40px auto 0' }}>
      <div
        className="card"
        style={{
          padding: 32, textAlign: 'center',
          background: state === 'ok' ? '#dcfce7' : state === 'error' ? '#fee2e2' : 'var(--surface)',
          border: `1px solid ${state === 'ok' ? '#16a34a' : state === 'error' ? '#dc2626' : 'var(--border)'}`,
        }}
      >
        {state === 'pending' && (
          <>
            <div style={{ fontSize: 40, marginBottom: 12 }}>⏳</div>
            <h1 style={{ margin: 0 }}>Email megerősítése…</h1>
            <p className="muted" style={{ marginTop: 8, marginBottom: 0 }}>
              Pár másodperc, és kész vagyunk.
            </p>
          </>
        )}

        {state === 'ok' && (
          <>
            <div style={{ fontSize: 40, marginBottom: 12 }}>✅</div>
            <h1 style={{ margin: 0, color: '#14532d' }}>Email megerősítve!</h1>
            <p style={{ marginTop: 8, color: '#14532d' }}>
              Köszönjük! A fiókod most már teljesen aktív.
            </p>
            <Link
              href="/bejelentkezes"
              className="btn"
              style={{ display: 'inline-block', marginTop: 16, textDecoration: 'none' }}
            >
              Bejelentkezés →
            </Link>
          </>
        )}

        {state === 'error' && (
          <>
            <div style={{ fontSize: 40, marginBottom: 12 }}>❌</div>
            <h1 style={{ margin: 0, color: '#7f1d1d' }}>A megerősítés nem sikerült</h1>
            <p style={{ marginTop: 8, color: '#7f1d1d', fontSize: 14 }}>
              {error || 'Érvénytelen vagy lejárt link.'}
            </p>
            <p style={{ marginTop: 12, fontSize: 13, color: '#7f1d1d' }}>
              Jelentkezz be és kérj új linket a profil oldalon.
            </p>
            <Link
              href="/bejelentkezes"
              className="btn"
              style={{ display: 'inline-block', marginTop: 16, textDecoration: 'none' }}
            >
              Bejelentkezés
            </Link>
          </>
        )}
      </div>
    </div>
  );
}

export default function EmailMegerositese() {
  return (
    <Suspense fallback={<p>Betöltés…</p>}>
      <EmailMegerositeseInner />
    </Suspense>
  );
}
