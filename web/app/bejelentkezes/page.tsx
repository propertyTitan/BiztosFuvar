'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { api } from '@/api';

export default function Bejelentkezes() {
  const router = useRouter();
  const [email, setEmail] = useState('kovacs.peter@example.hu');
  const [password, setPassword] = useState('Jelszo123!');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError(null);
    try {
      const res = await api.login(email, password);
      window.localStorage.setItem('biztosfuvar_token', res.token);
      window.localStorage.setItem('biztosfuvar_user', JSON.stringify(res.user));
      router.push('/dashboard');
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div style={{ maxWidth: 420 }}>
      <h1>Bejelentkezés</h1>
      <form onSubmit={onSubmit} className="card">
        <label>Email</label>
        <input className="input" type="email" value={email} onChange={(e) => setEmail(e.target.value)} required />
        <label>Jelszó</label>
        <input className="input" type="password" value={password} onChange={(e) => setPassword(e.target.value)} required />
        {error && <p style={{ color: 'var(--danger)' }}>{error}</p>}
        <button className="btn" type="submit" disabled={loading} style={{ marginTop: 16 }}>
          {loading ? 'Belépés...' : 'Belépés'}
        </button>
        <p className="muted" style={{ fontSize: 12, marginTop: 16 }}>
          Tipp: a seed scriptben minden mintafelhasználó jelszava: <code>Jelszo123!</code>
        </p>
      </form>
    </div>
  );
}
