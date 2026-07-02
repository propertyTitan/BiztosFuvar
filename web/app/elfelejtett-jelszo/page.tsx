'use client';

// Elfelejtett jelszó űrlap.
// Biztonsági okokból a backend AKKOR is 200-at ad ha a megadott email
// nem létezik (enumeration védelem). A user mindig ugyanazt a generic
// üzenetet látja: „ha létezik, küldtünk emailt".

import { useState } from 'react';
import Link from 'next/link';
import { api } from '@/api';

export default function ElfelejtettJelszo() {
  const [email, setEmail] = useState('');
  const [submitted, setSubmitted] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError(null);
    try {
      const r = await api.forgotPassword(email);
      setMessage(r.message);
      setSubmitted(true);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div style={{ maxWidth: 440, margin: '0 auto' }}>
      <h1 style={{ marginBottom: 8 }}>Elfelejtett jelszó</h1>
      <p className="muted" style={{ marginTop: 0 }}>
        Add meg az email címed és küldünk egy linket a jelszó visszaállításához.
      </p>

      {submitted ? (
        <div
          className="card"
          style={{
            marginTop: 24,
            padding: 24,
            background: 'var(--success-light)',
            border: '1px solid var(--success)',
            color: '#14532d',
          }}
        >
          <p style={{ margin: 0, fontWeight: 600 }}>📧 Ellenőrizd a postaládád!</p>
          <p style={{ marginTop: 8, marginBottom: 0, fontSize: 14 }}>{message}</p>
          <p style={{ marginTop: 16, marginBottom: 0, fontSize: 13 }}>
            <Link href="/bejelentkezes" style={{ color: 'var(--primary)' }}>
              ← Vissza a bejelentkezéshez
            </Link>
          </p>
        </div>
      ) : (
        <form onSubmit={onSubmit} style={{ marginTop: 24 }}>
          <label style={{ display: 'block', marginBottom: 6, fontSize: 14, fontWeight: 600 }}>
            Email cím
          </label>
          <input
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required
            autoFocus
            placeholder="te@example.com"
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
            disabled={loading || !email}
            style={{ marginTop: 16, width: '100%' }}
          >
            {loading ? 'Küldés…' : 'Reset link küldése →'}
          </button>

          <p style={{ textAlign: 'center', marginTop: 12, fontSize: 13 }}>
            <Link href="/bejelentkezes" style={{ color: 'var(--primary)' }}>
              ← Vissza a bejelentkezéshez
            </Link>
          </p>
        </form>
      )}
    </div>
  );
}
