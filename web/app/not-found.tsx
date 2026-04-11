'use client';

// Next.js App Router custom 404 oldal.
//
// Mód-érzékeny: ha az URL alapján látható, hogy a felhasználó egy másik
// mód (sofőr vagy feladó) alatti oldalra tévedt, akkor **mód-váltási
// javaslatot** mutatunk, nem sima 404-et.
//
// Példa: a user Sofőr módban van, de rákattint egy feladói linkre
// (pl. /dashboard/uj-fuvar), ami a mobilos menüben "feladó oldal".
// A backend 404 helyett a frontend elmagyarázza, hogy ez feladó mód,
// és egy kattintással át tudjon váltani.
import { useEffect, useState } from 'react';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';

type Mode = 'driver' | 'shipper';

// A két fő "módot" útvonalak alapján ismerjük fel:
// - /sofor/*          → sofőr-specifikus
// - /dashboard/*      → feladó-specifikus (a feladó dashboardja)
// - /hirdeteseim, /profil, /ertesitesek → közös / neutral
function guessModeFromPath(path: string | null): Mode | null {
  if (!path) return null;
  if (path.startsWith('/sofor/')) return 'driver';
  if (path.startsWith('/dashboard/')) return 'shipper';
  return null;
}

export default function NotFound() {
  const path = usePathname();
  const router = useRouter();
  const [currentMode, setCurrentMode] = useState<Mode | null>(null);

  useEffect(() => {
    const saved = localStorage.getItem('gofuvar_mode');
    if (saved === 'driver' || saved === 'shipper') {
      setCurrentMode(saved as Mode);
    } else {
      setCurrentMode('shipper');
    }
  }, []);

  const intended = guessModeFromPath(path);
  const isModeMismatch =
    currentMode && intended && currentMode !== intended;

  function switchMode(m: Mode) {
    localStorage.setItem('gofuvar_mode', m);
    // Kicsi késleltetés, hogy a localStorage mentés biztos megtörténjen,
    // aztán visszanavigálunk a főoldalra, ahol a HomeHub olvassa az új módot.
    router.push('/');
  }

  // ── Mód-váltási javaslat (intelligens 404) ──
  if (isModeMismatch) {
    const targetLabel = intended === 'shipper' ? 'Feladó' : 'Sofőr';
    const currentLabel = currentMode === 'shipper' ? 'Feladó' : 'Sofőr';
    const targetEmoji = intended === 'shipper' ? '📦' : '🚛';
    const currentEmoji = currentMode === 'shipper' ? '📦' : '🚛';

    return (
      <div
        style={{
          maxWidth: 520,
          margin: '64px auto',
          padding: '32px 24px',
          textAlign: 'center',
        }}
      >
        <div style={{ fontSize: 64, marginBottom: 16 }}>
          {currentEmoji} → {targetEmoji}
        </div>
        <h1 style={{ margin: '0 0 12px' }}>Másik mód szükséges</h1>
        <p style={{ color: 'var(--muted)', marginBottom: 28, lineHeight: 1.6 }}>
          Ez a funkció <strong>{targetLabel} módban</strong> érhető el, de te
          jelenleg <strong>{currentLabel} módban</strong> vagy.
          <br />
          Szeretnél átváltani?
        </p>
        <div
          style={{
            display: 'flex',
            gap: 12,
            justifyContent: 'center',
            flexWrap: 'wrap',
          }}
        >
          <button
            type="button"
            onClick={() => switchMode(intended)}
            className="btn"
            style={{ minWidth: 220 }}
          >
            {targetEmoji} Átváltás {targetLabel} módra
          </button>
          <Link
            href="/"
            className="btn btn-secondary"
            style={{ textDecoration: 'none' }}
          >
            ← Vissza a főoldalra
          </Link>
        </div>
      </div>
    );
  }

  // ── Klasszikus 404 (nem mód-váltási helyzet) ──
  return (
    <div
      style={{
        maxWidth: 520,
        margin: '64px auto',
        padding: '32px 24px',
        textAlign: 'center',
      }}
    >
      <div style={{ fontSize: 72, marginBottom: 16 }}>🔎</div>
      <h1 style={{ margin: '0 0 12px' }}>Az oldal nem található</h1>
      <p style={{ color: 'var(--muted)', marginBottom: 28, lineHeight: 1.6 }}>
        Lehet, hogy egy régi linket követtél, vagy elgépelted a címet. Nincs
        gond, visszavezetünk a főoldalra.
      </p>
      <Link
        href="/"
        className="btn"
        style={{ textDecoration: 'none', minWidth: 220 }}
      >
        🏠 Vissza a főoldalra
      </Link>
    </div>
  );
}
