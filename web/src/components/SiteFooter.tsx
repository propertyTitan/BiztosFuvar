'use client';

import Link from 'next/link';

export default function SiteFooter() {
  return (
    <footer className="site-footer">
      <div style={{ fontWeight: 600, marginBottom: 4 }}>🚛 GoFuvar</div>
      <div>Bizalom. Fotó. Kód. Letét.</div>
      <div style={{ marginTop: 10, fontSize: 13, display: 'flex', gap: 16, justifyContent: 'center', flexWrap: 'wrap' }}>
        <Link href="/aszf" style={{ color: 'inherit', textDecoration: 'underline' }}>ÁSZF</Link>
        <Link href="/adatkezeles" style={{ color: 'inherit', textDecoration: 'underline' }}>Adatkezelési tájékoztató</Link>
      </div>
      <div style={{ marginTop: 8, fontSize: 12, opacity: 0.7 }}>
        © {new Date().getFullYear()} GoFuvar Kft. · Minden jog fenntartva.
      </div>
    </footer>
  );
}
