'use client';

import Link from 'next/link';
import { Wrench } from 'lucide-react';

export default function MentesBeerkezettDisabled() {
  return (
    <div style={{ maxWidth: 600, margin: '0 auto', textAlign: 'center', padding: 40 }}>
      <div style={{ marginBottom: 16, display: 'flex', justifyContent: 'center', color: 'var(--muted)' }}><Wrench size={56} aria-hidden /></div>
      <h1>Hamarosan elérhető</h1>
      <p className="muted">
        Az autómentés szolgáltatás jelenleg fejlesztés alatt áll.
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
