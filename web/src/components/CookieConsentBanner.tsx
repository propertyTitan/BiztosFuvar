'use client';

// Cookie consent banner — GDPR / e-Privacy direktíva.
//
// Először megjelenik a látogatóknak, akik még nem nyilatkoztak.
// A választást localStorage-ben tároljuk, így csak egyszer látja.

import { useEffect, useState } from 'react';
import Link from 'next/link';

const STORAGE_KEY = 'gofuvar_cookie_consent';

type Choice = 'accept' | 'decline';

export default function CookieConsentBanner() {
  const [show, setShow] = useState(false);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    const existing = window.localStorage.getItem(STORAGE_KEY);
    if (!existing) setShow(true);
  }, []);

  function decide(choice: Choice) {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify({
      choice,
      decided_at: new Date().toISOString(),
      version: 'cookie_v1_2026-05-09',
    }));
    setShow(false);
    window.dispatchEvent(new CustomEvent('gofuvar:cookie-consent', { detail: choice }));
  }

  if (!show) return null;

  return (
    <div
      role="dialog"
      aria-label="Süti nyilatkozat"
      style={{
        position: 'fixed', bottom: 0, left: 0, right: 0, zIndex: 1100,
        background: 'var(--bg)', borderTop: '1px solid var(--border)',
        padding: 16, boxShadow: '0 -4px 20px rgba(0,0,0,0.12)',
      }}
    >
      <div
        style={{
          maxWidth: 1100, margin: '0 auto',
          display: 'flex', gap: 16, alignItems: 'center', flexWrap: 'wrap',
        }}
      >
        <div style={{ flex: '1 1 360px', fontSize: 14, lineHeight: 1.5 }}>
          🍪 A GoFuvar a működéshez szükséges sütiket használ (bejelentkezés,
          szolgáltatás-elérés). Az „Elfogadom" gombbal hozzájárulsz a használatukhoz.
          Részletek az{' '}
          <Link href="/adatvedelem" style={{ color: 'var(--primary-text)' }}>
            Adatkezelési tájékoztatóban
          </Link>.
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          <button
            type="button"
            onClick={() => decide('decline')}
            style={{
              padding: '10px 16px', background: 'transparent',
              border: '1px solid var(--border)', color: 'var(--text)',
              borderRadius: 8, fontWeight: 600, cursor: 'pointer', fontSize: 13,
            }}
          >
            Csak a szükségest
          </button>
          <button
            type="button"
            onClick={() => decide('accept')}
            style={{
              padding: '10px 16px', background: 'var(--primary)',
              border: 'none', color: '#fff', borderRadius: 8,
              fontWeight: 700, cursor: 'pointer', fontSize: 13,
            }}
          >
            Elfogadom
          </button>
        </div>
      </div>
    </div>
  );
}
