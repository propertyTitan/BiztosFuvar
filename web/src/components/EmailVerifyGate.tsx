'use client';

// Kemény email-megerősítő kapu: a bejelentkezett, de MÉG NEM megerősített
// email-című felhasználót egy blokkoló overlay állítja meg — csak a
// megerősítés után léphet tovább az oldalon. (A korábbi EmailVerifyBanner
// csak figyelmeztetett, ez ténylegesen blokkol.)
//
// Kivétel: a /email-megerositese céloldal SOHA nem blokkolható, különben a
// user nem tudná végrehajtani a megerősítést a linkről.

import { useEffect, useState } from 'react';
import { usePathname } from 'next/navigation';
import { api } from '@/api';
import { useCurrentUser, clearCurrentUser } from '@/lib/auth';

export default function EmailVerifyGate() {
  const user = useCurrentUser();
  const pathname = usePathname();
  const [unverified, setUnverified] = useState(false);
  const [email, setEmail] = useState('');
  const [resending, setResending] = useState(false);
  const [sent, setSent] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    // User-váltásnál (login/logout) nullázunk, sosem mutatunk régi adatot.
    setUnverified(false);
    setEmail('');
    setSent(false);
    setError(null);
    if (!user) return undefined;
    let cancelled = false;
    api.getMyProfile()
      .then((me: any) => {
        if (!cancelled && me) {
          setEmail(me.email || '');
          setUnverified(me.email_verified === false);
        }
      })
      .catch(() => { /* hiba esetén nem blokkolunk keményen */ });
    return () => { cancelled = true; };
  }, [user?.id]);

  // A megerősítő link céloldalát sosem blokkoljuk.
  const exempt = !!pathname && pathname.startsWith('/email-megerositese');
  if (!user || exempt || !unverified) return null;

  async function resend() {
    setResending(true);
    setError(null);
    try {
      await api.resendVerification();
      setSent(true);
    } catch (e: any) {
      setError(e?.message || 'Nem sikerült az újraküldés. Próbáld később.');
    } finally {
      setResending(false);
    }
  }

  function logout() {
    clearCurrentUser();
    window.location.href = '/bejelentkezes';
  }

  return (
    <div
      style={{
        position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.6)', zIndex: 1100,
        display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16,
      }}
      role="dialog"
      aria-modal="true"
    >
      <div className="card" style={{ maxWidth: 480, marginBottom: 0, textAlign: 'center' }}>
        <div style={{ fontSize: 44, marginBottom: 8 }}>📧</div>
        <h2 style={{ marginTop: 0 }}>Erősítsd meg az email címed</h2>
        <p style={{ color: 'var(--text)', lineHeight: 1.6 }}>
          Küldtünk egy megerősítő linket ide: <strong>{email}</strong>. Kattints rá,
          mielőtt tovább mennél az oldalon. (Nézd meg a spam mappát is.)
        </p>
        {sent && (
          <p style={{ color: 'var(--success-text)', fontSize: 14, margin: '4px 0 0' }}>
            Új linket küldtünk. ✓
          </p>
        )}
        {error && (
          <p style={{ color: 'var(--danger-text)', fontSize: 13, margin: '4px 0 0' }}>{error}</p>
        )}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10, marginTop: 18 }}>
          <button className="btn" onClick={() => window.location.reload()} style={{ width: '100%' }}>
            Már megerősítettem — folytatom
          </button>
          <button className="btn btn-ghost" onClick={resend} disabled={resending} style={{ width: '100%' }}>
            {resending ? 'Küldés…' : 'Új link kérése'}
          </button>
          <button
            onClick={logout}
            style={{
              background: 'transparent', border: 'none', color: 'var(--muted)',
              cursor: 'pointer', fontSize: 13, textDecoration: 'underline', marginTop: 2,
            }}
          >
            Kijelentkezés
          </button>
        </div>
      </div>
    </div>
  );
}
