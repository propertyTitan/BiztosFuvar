'use client';

// Autómentés jelenleg letiltva — jogi engedélyezés folyamatban.
// A backend + DB megmarad (migration 025, 026), bármikor visszakapcsolható
// a navigáció helyreállításával (SiteHeader.tsx + LandingPage.tsx).

import Link from 'next/link';
import { Wrench } from 'lucide-react';

export default function MentesDisabled() {
  return (
    <div style={{ maxWidth: 600, margin: '0 auto', textAlign: 'center', padding: 40 }}>
      <div style={{ marginBottom: 16, display: 'flex', justifyContent: 'center', color: 'var(--muted)' }}><Wrench size={56} aria-hidden /></div>
      <h1>Hamarosan elérhető</h1>
      <p className="muted">
        Az autómentés szolgáltatás jelenleg fejlesztés alatt áll.
        Nézz vissza később!
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
