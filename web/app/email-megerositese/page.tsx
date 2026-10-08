'use client';

// Email-megerősítés céloldal. A user a regisztrációkor kapott emailben
// erre az URL-re kattint (?token=...). Mi azonnal hívjuk a backend-et.

import { useEffect, useState, Suspense } from 'react';
import { useSearchParams } from 'next/navigation';
import Link from 'next/link';
import { Hourglass, CircleCheck, XCircle } from 'lucide-react';
import { api } from '@/api';
import { HozasdElVerifiedContinue } from '@/components/HozasdElContinuation';

function EmailMegerositeseInner() {
  const params = useSearchParams();
  const token = params.get('token') || '';
  const [state, setState] = useState<'pending' | 'ok' | 'error'>('pending');
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setState('pending');
    setError(null);
    if (!token) {
      setState('error');
      setError('Hiányzó token a linkben.');
      return;
    }
    api.verifyEmail(token)
      .then(() => { if (!cancelled) setState('ok'); })
      .catch((e: any) => {
        if (cancelled) return;
        setState('error');
        setError(e.message);
      });
    return () => { cancelled = true; };
  }, [token]);

  return (
    <div style={{ maxWidth: 440, margin: '40px auto 0' }}>
      <div
        className="card"
        style={{
          padding: 32, textAlign: 'center',
          background: state === 'ok' ? 'var(--success-light)' : state === 'error' ? 'var(--danger-light)' : 'var(--surface)',
          border: `1px solid ${state === 'ok' ? 'var(--success)' : state === 'error' ? 'var(--danger)' : 'var(--border)'}`,
        }}
      >
        {state === 'pending' && (
          <>
            <div style={{ marginBottom: 12, display: 'flex', justifyContent: 'center' }}><Hourglass size={40} aria-hidden /></div>
            <h1 style={{ margin: 0 }}>E-mail-cím megerősítése…</h1>
            <p className="muted" style={{ marginTop: 8, marginBottom: 0 }}>
              Pár másodperc, és kész vagyunk.
            </p>
          </>
        )}

        {state === 'ok' && (
          <>
            <div style={{ marginBottom: 12, display: 'flex', justifyContent: 'center', color: '#14532d' }}><CircleCheck size={40} aria-hidden /></div>
            <h1 style={{ margin: 0, color: '#14532d' }}>E-mail-cím megerősítve!</h1>
            <p style={{ marginTop: 8, color: '#14532d' }}>
              Átirányítunk a bejelentkezéshez.
            </p>
            <HozasdElVerifiedContinue />
          </>
        )}

        {state === 'error' && (
          <>
            <div style={{ marginBottom: 12, display: 'flex', justifyContent: 'center', color: '#7f1d1d' }}><XCircle size={40} aria-hidden /></div>
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
