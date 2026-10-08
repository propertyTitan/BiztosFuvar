'use client';

import Link from 'next/link';
import { Truck } from 'lucide-react';
import { landingLinks } from '@/lib/landings';
import { KERESKEDO } from '@/lib/kereskedo';
import { CibSzolgaltato, ElfogadottKartyak } from '@/components/CibLogok';
import { useCurrentUser } from '@/lib/auth';

export default function SiteFooter() {
  const user = useCurrentUser();
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

      <div style={{ fontWeight: 600, marginBottom: 4, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6 }}>
        <Truck size={16} aria-hidden /> GoFuvar
      </div>
      <div style={{ fontWeight: 700 }}>Ha fuvar kell, akkor GoFuvar.</div>
      <div style={{ marginTop: 10, fontSize: 13, display: 'flex', gap: 16, justifyContent: 'center', flexWrap: 'wrap' }}>
        <Link href="/aszf" style={{ color: 'inherit', textDecoration: 'underline' }}>ÁSZF</Link>
        <Link href="/adatkezeles" style={{ color: 'inherit', textDecoration: 'underline' }}>Adatkezelési tájékoztató</Link>
        {/* A CIB vásárlói tájékoztatója (banki teszt: „Bankkártyás fizetés" link). */}
        <Link href="/bankkartyas-fizetes" style={{ color: 'inherit', textDecoration: 'underline' }}>Bankkártyás fizetés</Link>
        {/* A banki javaslat: a kereskedő elérhetősége lehetőleg „Kapcsolat"
            linken érhető el — a cél a lent álló cím-blokk (minden oldalon). */}
        <a href="#kapcsolat" style={{ color: 'inherit', textDecoration: 'underline' }}>Kapcsolat</a>
      </div>
      {/* CIB PR-3 — a banki átvételi teszt kötelező elemei a főoldalon is:
          CIB-logó a „Kártyás fizetés szolgáltatója:" felirattal (a
          tájékoztatóra linkelve) és az „Elfogadott kártyák" logósor. */}
      <div style={{ marginTop: 14, display: 'flex', flexDirection: 'column', gap: 8, alignItems: 'center' }}>
        <CibSzolgaltato igazitas="kozep" />
        <ElfogadottKartyak igazitas="kozep" />
      </div>
      {/* Support-csatorna (2026-09-11, C2): eddig SEHOL nem volt látható elérhetőség a felületen */}
      <div style={{ marginTop: 10, fontSize: 13, display: 'flex', gap: 16, justifyContent: 'center', flexWrap: 'wrap' }}>
        <a href="mailto:info@gofuvar.hu" style={{ color: 'inherit', textDecoration: 'underline' }}>Segítség: info@gofuvar.hu</a>
        <a href="mailto:panasz@gofuvar.hu" style={{ color: 'inherit', textDecoration: 'underline' }}>Panasz: panasz@gofuvar.hu</a>
        {/* UX-kör A9: az AI-asszisztens belépéshez kötött (e-mail-kapu) — a
            látogatónak eddig egy olyan link volt itt, ami szó nélkül a
            belépésre dobta. Most kimondjuk, és a belépés után oda visz. */}
        {user ? (
          <Link href="/ai-chat" style={{ color: 'inherit', textDecoration: 'underline' }}>AI-asszisztens</Link>
        ) : (
          <Link href="/bejelentkezes?next=%2Fai-chat" style={{ color: 'inherit', textDecoration: 'underline' }}>AI-asszisztens (belépés után)</Link>
        )}
      </div>
      {/* A kereskedő elérhetősége (banki teszt: adószám, székhely, telefon,
          e-mail kötelező; az ÁSZF-link fent). */}
      <address
        id="kapcsolat"
        style={{
          scrollMarginTop: 80,
          marginTop: 10, fontSize: 12, fontStyle: 'normal', lineHeight: 1.6,
          maxWidth: 760, marginLeft: 'auto', marginRight: 'auto',
        }}
      >
        {KERESKEDO.teljesNev} ({KERESKEDO.rovidNev}) · Székhely: {KERESKEDO.szekhely}, {KERESKEDO.orszag}
        {' · '}Cégjegyzékszám: {KERESKEDO.cegjegyzekszam} · Adószám: {KERESKEDO.adoszam}
        {' · '}Telefon: <a href={KERESKEDO.telefonHref} style={{ color: 'inherit' }}>{KERESKEDO.telefon}</a>
        {' · '}E-mail: <a href={`mailto:${KERESKEDO.email}`} style={{ color: 'inherit' }}>{KERESKEDO.email}</a>
      </address>
      <div style={{ marginTop: 8, fontSize: 12, opacity: 0.7 }}>
        © {new Date().getFullYear()} GoFuvar · {KERESKEDO.rovidNev} · Minden jog fenntartva.
      </div>
    </footer>
  );
}
