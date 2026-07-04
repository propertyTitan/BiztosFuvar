'use client';

// Bannert mutat a verifikálatlan email-felhasználóknak. Nem blokkol,
// csak figyelmeztet és lehetőséget ad új link kérésére.
//
// BUG-015 fix: a banner a bejelentkezett USERT követi (useCurrentUser),
// nem egyszeri mount-kori lekérés. A login/logout kliens-oldali navigáció
// (nincs teljes újratöltés), így a korábbi verzió user-váltás után is a
// RÉGI user email-címét mutatta — adatvédelmi hiba közös gépen.

import { useEffect, useState } from 'react';
import { api } from '@/api';
import { useCurrentUser } from '@/lib/auth';

export default function EmailVerifyBanner() {
  const user = useCurrentUser();
  const [show, setShow] = useState(false);
  const [email, setEmail] = useState('');
  const [resending, setResending] = useState(false);
  const [done, setDone] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    // User-váltásnál (login/logout) minden állapot nullázódik — a banner
    // sosem mutathatja egy korábbi user adatát.
    setShow(false);
    setEmail('');
    setDone(false);
    setError(null);
    if (!user) return undefined;

    api.getMyProfile()
      .then((me: any) => {
        if (!cancelled && me && me.email_verified === false) {
          setShow(true);
          setEmail(me.email);
        }
      })
      .catch(() => {});

    return () => { cancelled = true; };
  }, [user?.id]);

  async function resend() {
    setResending(true);
    setError(null);
    try {
      await api.resendVerification();
      setDone(true);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setResending(false);
    }
  }

  if (!show) return null;

  return (
    <div
      style={{
        background: 'var(--warning-light)',
        border: '1px solid var(--warning)',
        color: 'var(--text)',
        padding: '10px 16px',
        fontSize: 14,
        display: 'flex',
        alignItems: 'center',
        gap: 12,
        flexWrap: 'wrap',
      }}
    >
      <span style={{ fontSize: 18 }}>📧</span>
      <span style={{ flex: '1 1 200px' }}>
        Az email címed (<strong>{email}</strong>) még nincs megerősítve.{' '}
        {done
          ? <span>Új linket küldtünk — nézd meg a postaládád + spam mappát.</span>
          : <button
              onClick={resend}
              disabled={resending}
              style={{
                background: 'transparent',
                border: 'none',
                color: 'var(--text)',
                fontWeight: 700,
                textDecoration: 'underline',
                cursor: 'pointer',
                padding: 0,
                fontSize: 14,
              }}
            >
              {resending ? 'Küldés…' : 'Küldj egy új linket'}
            </button>
        }
        {error && <span style={{ marginLeft: 8, color: 'var(--text)' }}> ⚠ {error}</span>}
      </span>
      <button
        onClick={() => setShow(false)}
        style={{
          background: 'transparent', border: 'none', cursor: 'pointer',
          color: 'var(--text)', fontSize: 18, padding: 4,
        }}
        title="Bezár"
      >
        ✕
      </button>
    </div>
  );
}
