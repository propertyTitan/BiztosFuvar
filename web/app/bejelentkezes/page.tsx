'use client';

// Bejelentkezés + Regisztráció egyben — toggle-lel váltogatható.
// A Vercel-es prod deployhoz kellett a regisztráció, mert a seed
// felhasználók nem léteznek a Neon DB-ben, és új usert csak curl-lel
// lehetett korábban létrehozni.
//
// Query param-mal lehet előre beállítani a fület:
//   /bejelentkezes              → alapból "login"
//   /bejelentkezes?mode=register → alapból "register" (landing CTA-hoz)
import { useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { api } from '@/api';
import { setCurrentUser, homeForRole, Role } from '@/lib/auth';

type Mode = 'login' | 'register';

export default function Bejelentkezes() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const initialMode: Mode = searchParams.get('mode') === 'register' ? 'register' : 'login';
  const [mode, setMode] = useState<Mode>(initialMode);

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [fullName, setFullName] = useState('');
  const [phone, setPhone] = useState('');

  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError(null);
    try {
      const res =
        mode === 'login'
          ? await api.login(email, password)
          : await api.register({ email, password, full_name: fullName, phone });

      setCurrentUser(
        {
          id: res.user.id,
          email: (res.user as any).email,
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

  function switchMode(m: Mode) {
    setMode(m);
    setError(null);
  }

  return (
    <div style={{ maxWidth: 440, margin: '0 auto' }}>
      {/* ── Tab-váltó ── */}
      <div
        style={{
          display: 'flex',
          gap: 4,
          background: 'var(--surface)',
          borderRadius: 12,
          padding: 4,
          border: '1px solid var(--border)',
          marginBottom: 20,
        }}
      >
        <button
          type="button"
          onClick={() => switchMode('login')}
          style={{
            flex: 1,
            padding: '10px 0',
            borderRadius: 10,
            border: 'none',
            fontWeight: 700,
            fontSize: 14,
            cursor: 'pointer',
            transition: 'all 0.15s',
            background: mode === 'login' ? 'var(--primary)' : 'transparent',
            color: mode === 'login' ? '#fff' : 'var(--muted)',
          }}
        >
          Belépés
        </button>
        <button
          type="button"
          onClick={() => switchMode('register')}
          style={{
            flex: 1,
            padding: '10px 0',
            borderRadius: 10,
            border: 'none',
            fontWeight: 700,
            fontSize: 14,
            cursor: 'pointer',
            transition: 'all 0.15s',
            background: mode === 'register' ? 'var(--primary)' : 'transparent',
            color: mode === 'register' ? '#fff' : 'var(--muted)',
          }}
        >
          Regisztráció
        </button>
      </div>

      <h1 style={{ marginTop: 0 }}>
        {mode === 'login' ? 'Üdv újra! 👋' : 'Csatlakozz a GoFuvarhoz 🚛'}
      </h1>
      <p className="muted" style={{ marginTop: 4, marginBottom: 20 }}>
        {mode === 'login'
          ? 'Lépj be a fiókodba a folytatáshoz.'
          : 'Pár másodperc az egész. Ingyenes, és nincs havidíj.'}
      </p>

      <form onSubmit={onSubmit} className="card">
        {mode === 'register' && (
          <>
            <label>Teljes név</label>
            <input
              className="input"
              type="text"
              value={fullName}
              onChange={(e) => setFullName(e.target.value)}
              placeholder="Pl. Kovács Péter"
              required
            />
            <label>Telefon (opcionális)</label>
            <input
              className="input"
              type="tel"
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
              placeholder="+36 30 123 4567"
            />
          </>
        )}

        <label>Email</label>
        <input
          className="input"
          type="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          placeholder="pelda@email.hu"
          required
        />

        <label>Jelszó</label>
        <input
          className="input"
          type="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          placeholder={mode === 'register' ? 'Legalább 8 karakter' : ''}
          minLength={mode === 'register' ? 8 : undefined}
          required
        />

        {error && (
          <p style={{ color: 'var(--danger)', marginTop: 8, fontSize: 14 }}>
            ⚠️ {error}
          </p>
        )}

        <button
          className="btn"
          type="submit"
          disabled={loading}
          style={{ marginTop: 16, width: '100%' }}
        >
          {loading
            ? mode === 'login'
              ? 'Belépés…'
              : 'Regisztráció…'
            : mode === 'login'
            ? 'Belépés →'
            : 'Fiók létrehozása →'}
        </button>

        {mode === 'register' && (
          <p className="muted" style={{ fontSize: 12, marginTop: 12, textAlign: 'center' }}>
            A regisztrációval elfogadod az ÁSZF-et és az Adatvédelmi tájékoztatót.
          </p>
        )}
      </form>
    </div>
  );
}
