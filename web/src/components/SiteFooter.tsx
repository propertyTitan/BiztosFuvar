'use client';

import Link from 'next/link';
import { landingLinks } from '@/lib/landings';

export default function SiteFooter() {
  const links = landingLinks();
  const groups: { title: string; kind: 'route' | 'persona' | 'usecase' }[] = [
    { title: 'Útvonalak', kind: 'route' },
    { title: 'Neked', kind: 'persona' },
    { title: 'Mire jó', kind: 'usecase' },
  ];

  return (
    <footer className="site-footer">
      {/* Népszerű / kattintható oldalak — SEO belső linkelés + felfedezés */}
      <div style={{
        display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))',
        gap: 20, maxWidth: 760, margin: '0 auto 24px', textAlign: 'left',
      }}>
        {groups.map((g) => (
          <div key={g.kind}>
            <div style={{ fontSize: 12, fontWeight: 700, textTransform: 'uppercase', letterSpacing: 0.4, opacity: 0.7, marginBottom: 8 }}>
              {g.title}
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              {links.filter((l) => l.kind === g.kind).map((l) => (
                <Link key={l.href} href={l.href} style={{ color: 'inherit', textDecoration: 'none', fontSize: 13, opacity: 0.9 }}>
                  {l.label}
                </Link>
              ))}
            </div>
          </div>
        ))}
      </div>

      <div style={{ fontWeight: 600, marginBottom: 4 }}>🚛 GoFuvar</div>
      <div style={{ fontWeight: 700 }}>Ha fuvar kell, akkor GoFuvar.</div>
      <div style={{ marginTop: 10, fontSize: 13, display: 'flex', gap: 16, justifyContent: 'center', flexWrap: 'wrap' }}>
        <Link href="/aszf" style={{ color: 'inherit', textDecoration: 'underline' }}>ÁSZF</Link>
        <Link href="/adatkezeles" style={{ color: 'inherit', textDecoration: 'underline' }}>Adatkezelési tájékoztató</Link>
      </div>
      <div style={{ marginTop: 8, fontSize: 12, opacity: 0.7 }}>
        © {new Date().getFullYear()} GoFuvar · Tiszta Hód Kft. · Minden jog fenntartva.
      </div>
    </footer>
  );
}
