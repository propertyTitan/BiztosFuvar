'use client';

// A mezők üresen indulnak, hogy profilváltáskor ne fussanak be a
// tesztfelhasználók pre-fill-elt adatai (könnyen azt hiszi az ember,
// hogy "ez vagyok én", és beléptet másnak).
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { api } from '@/api';
import { setCurrentUser, homeForRole, Role } from '@/lib/auth';

export default function Bejelentkezes() {
  const router = useRouter();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError(null);
    try {
      const res = await api.login(email, password);
      // A res.user a backend-től, role-lal együtt
      setCurrentUser(
        {
          id: res.user.id,
          email: res.user.email,
          role: res.user.role as Role,
          full_name: (res.user as any).full_name,
        },
        res.token,
      );
      router.push(homeForRole(res.user.role as Role));
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
          Tipp: a seed felhasználók jelszava: <code>Jelszo123!</code>
          <br />
          Feladó: <code>kovacs.peter@example.hu</code>
          <br />
          Sofőr: <code>szabo.janos@example.hu</code>
        </p>
      </form>
    </div>
  );
}
