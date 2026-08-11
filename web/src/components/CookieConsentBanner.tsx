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
          {/* ⚠️ 2026-08-11: a szöveg korábban HOZZÁJÁRULÁST kért — miközben a
              tájékoztató kimondja, hogy a működéshez szükséges sütikhez nem
              kérünk külön hozzájárulást, és a két gomb hatása azonos is volt.
              Egy látszat-választás rosszabb, mint a nyílt tájékoztatás. */}
          🍪 A GoFuvar <strong>kizárólag a működéshez szükséges</strong> sütiket és
          böngészői tárolókat használ (bejelentkezés, nézet- és téma-választás).
          Marketing- vagy analitikai sütit nem helyezünk el, és nem követünk
          harmadik feleken keresztül — ezekhez nem is kérünk hozzájárulást.
          Részletek az{' '}
          <Link href="/adatkezeles" style={{ color: 'var(--primary-text)' }}>
            Adatkezelési tájékoztatóban
          </Link>.
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          <button
            type="button"
            onClick={() => decide('accept')}
            style={{
              padding: '10px 16px', background: 'var(--primary)',
              border: 'none', color: '#fff', borderRadius: 8,
              fontWeight: 700, cursor: 'pointer', fontSize: 13,
            }}
          >
            Rendben, értem
          </button>
        </div>
      </div>
    </div>
  );
}
