'use client';

// Jelszó-visszaállítás form. A token a query-paramban érkezik.

import { useEffect, useState, Suspense } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import Link from 'next/link';
import { api } from '@/api';

function JelszoResetInner() {
  const router = useRouter();
  const params = useSearchParams();
  const token = params.get('token') || '';

  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [done, setDone] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!token) setError('Hiányzó token. Kérj új linket az "Elfelejtett jelszó" oldalon.');
  }, [token]);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (password.length < 8) {
      setError('A jelszó minimum 8 karakter legyen.');
      return;
    }
    if (password !== confirm) {
      setError('A két jelszó nem egyezik.');
      return;
    }
    setLoading(true);
    try {
      await api.resetPassword(token, password);
      setDone(true);
      setTimeout(() => router.push('/bejelentkezes'), 2000);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  if (done) {
    return (
      <div style={{ maxWidth: 440, margin: '0 auto' }}>
        <div
          className="card"
          style={{
            padding: 24, background: 'var(--success-light)', border: '1px solid var(--success)', color: '#14532d',
          }}
        >
          <h2 style={{ margin: 0 }}>✅ Új jelszó beállítva</h2>
          <p style={{ marginTop: 8, marginBottom: 0 }}>
            Sikeres jelszó-csere. Átirányítunk a bejelentkezéshez…
          </p>
        </div>
      </div>
    );
  }

  return (
    <div style={{ maxWidth: 440, margin: '0 auto' }}>
      <h1 style={{ marginBottom: 8 }}>Új jelszó beállítása</h1>
      <p className="muted" style={{ marginTop: 0 }}>
        Add meg az új jelszavadat. Minimum 8 karakter.
      </p>

      <form onSubmit={onSubmit} style={{ marginTop: 24 }}>
        <label style={{ display: 'block', marginBottom: 6, fontSize: 14, fontWeight: 600 }}>
          Új jelszó
        </label>
        <input
          type="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          required
          autoFocus
          minLength={8}
          placeholder="legalább 8 karakter"
          style={{
            width: '100%', padding: '12px 14px', fontSize: 15,
            border: '1px solid var(--border)', borderRadius: 8,
            background: 'var(--bg)', color: 'var(--text)', marginBottom: 12,
          }}
        />

        <label style={{ display: 'block', marginBottom: 6, fontSize: 14, fontWeight: 600 }}>
          Jelszó megerősítése
        </label>
        <input
          type="password"
          value={confirm}
          onChange={(e) => setConfirm(e.target.value)}
          required
          minLength={8}
          placeholder="add meg újra"
          style={{
            width: '100%', padding: '12px 14px', fontSize: 15,
            border: '1px solid var(--border)', borderRadius: 8,
            background: 'var(--bg)', color: 'var(--text)',
          }}
        />

        {error && (
          <p style={{ color: 'var(--danger)', marginTop: 12, fontSize: 14 }}>⚠️ {error}</p>
        )}

        <button
          className="btn"
          type="submit"
          disabled={loading || !token || !password || !confirm}
          style={{ marginTop: 16, width: '100%' }}
        >
          {loading ? 'Mentés…' : 'Jelszó mentése →'}
        </button>

        <p style={{ textAlign: 'center', marginTop: 12, fontSize: 13 }}>
          <Link href="/bejelentkezes" style={{ color: 'var(--primary)' }}>
            ← Vissza a bejelentkezéshez
          </Link>
        </p>
      </form>
    </div>
  );
}

export default function JelszoReset() {
  return (
    <Suspense fallback={<p>Betöltés…</p>}>
      <JelszoResetInner />
    </Suspense>
  );
}
