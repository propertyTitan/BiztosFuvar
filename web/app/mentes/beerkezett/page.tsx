'use client';

import Link from 'next/link';

export default function MentesBeerkezettDisabled() {
  return (
    <div style={{ maxWidth: 600, margin: '0 auto', textAlign: 'center', padding: 40 }}>
      <div style={{ fontSize: 64, marginBottom: 16 }}>🔧</div>
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
