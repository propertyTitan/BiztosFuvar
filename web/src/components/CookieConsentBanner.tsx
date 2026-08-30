'use client';

// Cookie consent banner — GDPR / e-Privacy direktíva.
//
// Először megjelenik a látogatóknak, akik még nem nyilatkoztak.
// A választást localStorage-ben tároljuk, így csak egyszer látja.

import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';

const STORAGE_KEY = 'gofuvar_cookie_consent';

type Choice = 'accept' | 'decline';

export default function CookieConsentBanner() {
  const [show, setShow] = useState(false);
  const savRef = useRef<HTMLDivElement>(null);
  // GF-022 (Manus, 2026-08-30): 320 px széles kijelzőn a teljes szöveg
  // ~252 px magas sávot adott — a képernyő 36%-át. Kis kijelzőn tömör
  // változat megy (a lényeg + link változatlan), nagyon a teljes.
  const [kompakt, setKompakt] = useState(false);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    const existing = window.localStorage.getItem(STORAGE_KEY);
    if (!existing) setShow(true);
  }, []);

  useEffect(() => {
    if (typeof window === 'undefined') return undefined;
    const mq = window.matchMedia('(max-width: 480px)');
    const kovet = () => setKompakt(mq.matches);
    kovet();
    mq.addEventListener('change', kovet);
    return () => mq.removeEventListener('change', kovet);
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

  // ⚠️ A SÁV NE TAKARJON EL KATTINTHATÓ ELEMEKET (2026-08-22, Manus-teszt:
  // GF-FT-07 + a süti-észrevétel EGY hiba). A sáv fixen az alsó szélen ül,
  // és a lap aljára eső gombokat (Fuvar lemondása, ajánlat-elfogadás)
  // FIZIKAILAG eltakarta — az első kattintás a sávot találta el, és némán
  // elveszett: úgy tűnt, „a modal nem nyílik meg". Amíg a sáv látszik, a
  // lap annyi alsó margót kap, hogy minden tartalom a sáv FÖLÉ görgethető.
  useEffect(() => {
    if (!show) return undefined;
    const igazit = () => {
      const magassag = savRef.current?.offsetHeight ?? 0;
      document.body.style.paddingBottom = magassag ? `${magassag + 8}px` : '';
    };
    igazit();
    window.addEventListener('resize', igazit);
    return () => {
      window.removeEventListener('resize', igazit);
      document.body.style.paddingBottom = '';
    };
  }, [show]);

  if (!show) return null;

  return (
    <div
      ref={savRef}
      role="dialog"
      aria-label="Süti nyilatkozat"
      style={{
        position: 'fixed', bottom: 0, left: 0, right: 0, zIndex: 1100,
        background: 'var(--bg)', borderTop: '1px solid var(--border)',
        padding: kompakt ? '10px 12px' : 16, boxShadow: '0 -4px 20px rgba(0,0,0,0.12)',
      }}
    >
      <div
        style={{
          maxWidth: 1100, margin: '0 auto',
          display: 'flex', gap: kompakt ? 10 : 16, alignItems: 'center', flexWrap: 'wrap',
        }}
      >
        <div style={{ flex: '1 1 240px', fontSize: kompakt ? 13 : 14, lineHeight: 1.5 }}>
          {/* ⚠️ 2026-08-11: a szöveg korábban HOZZÁJÁRULÁST kért — miközben a
              tájékoztató kimondja, hogy a működéshez szükséges sütikhez nem
              kérünk külön hozzájárulást, és a két gomb hatása azonos is volt.
              Egy látszat-választás rosszabb, mint a nyílt tájékoztatás. */}
          {kompakt ? (
            <>
              🍪 Csak a <strong>működéshez szükséges</strong> sütiket használjuk —
              marketing/analitika nincs, hozzájárulás nem kell.{' '}
              <Link href="/adatkezeles" style={{ color: 'var(--primary-text)' }}>
                Részletek
              </Link>.
            </>
          ) : (
            <>
              🍪 A GoFuvar <strong>kizárólag a működéshez szükséges</strong> sütiket és
              böngészői tárolókat használ (bejelentkezés, nézet- és téma-választás).
              Marketing- vagy analitikai sütit nem helyezünk el, és nem követünk
              harmadik feleken keresztül — ezekhez nem is kérünk hozzájárulást.
              Részletek az{' '}
              <Link href="/adatkezeles" style={{ color: 'var(--primary-text)' }}>
                Adatkezelési tájékoztatóban
              </Link>.
            </>
          )}
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
