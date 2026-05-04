'use client';

// Autómentés jelenleg letiltva — jogi engedélyezés folyamatban.
// A backend + DB megmarad (migration 025, 026), bármikor visszakapcsolható
// a navigáció helyreállításával (SiteHeader.tsx + LandingPage.tsx).

import Link from 'next/link';

export default function MentesDisabled() {
  return (
    <div style={{ maxWidth: 600, margin: '0 auto', textAlign: 'center', padding: 40 }}>
      <div style={{ fontSize: 64, marginBottom: 16 }}>🔧</div>
      <h1>Hamarosan elérhető</h1>
      <p className="muted">
        Az autómentés szolgáltatás jelenleg fejlesztés alatt áll.
        Kérjük, nézz vissza később!
      </p>
      <Link
        href="/"
        className="btn"
        style={{ marginTop: 16, textDecoration: 'none', display: 'inline-block' }}
      >
        Vissza a főoldalra
      </Link>
    </div>
  );
}
