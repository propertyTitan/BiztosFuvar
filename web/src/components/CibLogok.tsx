// =====================================================================
//  CIB-logó és kártyalogók — a banki átvételi teszt kötelező elemei
//
//  CIB „Fejlesztési javaslatok" — Tesztelési szempontok:
//   - „A webáruház főoldalán, valamint a fizetési módok kiválasztásának
//     oldalán a webáruház köteles megjeleníteni a CIB Bank logóját. A logó a
//     https://www.cib.hu/ vagy a vásárlói tájékoztató oldalra kell
//     irányítson. […] kísérő szöveg: „Kártyás fizetés szolgáltatója:""
//   - „az elfogadott bankkártya típusok logóit is fel kell tüntetni […]
//     kísérő szöveg: „Elfogadott kártyák""; a VeriSign (Norton) logó csak
//     saját tanúsítvánnyal — nekünk nincs, ezért nem tesszük ki.
//
//  A logók fehér „chipen" ülnek: a bank és a kártyatársaságok logói fehér
//  háttérre készültek, sötét témában is így olvashatók. A kártyalista az
//  ELFOGADOTT_KARTYAK konstansból jön (lib/kartyaLogok.ts).
// =====================================================================
import Link from 'next/link';
import type { CSSProperties } from 'react';
import { CIB_LOGO, ELFOGADOTT_KARTYAK, KARTYA_LOGOK } from '@/lib/kartyaLogok';
import { CIB_SZOLGALTATO_FELIRAT, ELFOGADOTT_KARTYAK_FELIRAT } from '@/lib/cibFeliratok';

const CHIP: CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  justifyContent: 'center',
  background: '#ffffff',
  border: '1px solid rgba(15,23,42,0.12)',
  borderRadius: 6,
  padding: '3px 6px',
  lineHeight: 0,
};

type Igazitas = 'bal' | 'kozep';

/** „Kártyás fizetés szolgáltatója:" + a CIB-logó.
 *  `kulso` = a bank honlapjára visz (a tájékoztató oldalon), egyébként a
 *  /bankkartyas-fizetes tájékoztatóra. */
export function CibSzolgaltato({ kulso = false, igazitas = 'bal' }: { kulso?: boolean; igazitas?: Igazitas }) {
  const logo = (
    // eslint-disable-next-line @next/next/no-img-element
    <img src={CIB_LOGO.src} alt={CIB_LOGO.nev} width={CIB_LOGO.szel} height={CIB_LOGO.mag} style={{ display: 'block' }} />
  );
  return (
    <div
      style={{
        display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap',
        justifyContent: igazitas === 'kozep' ? 'center' : 'flex-start',
      }}
    >
      <span style={{ fontSize: 12 }}>{CIB_SZOLGALTATO_FELIRAT}</span>
      {kulso ? (
        <a href="https://www.cib.hu/" target="_blank" rel="noopener noreferrer" style={CHIP}>{logo}</a>
      ) : (
        <Link href="/bankkartyas-fizetes" style={CHIP}>{logo}</Link>
      )}
    </div>
  );
}

/** „Elfogadott kártyák" + a szerződés szerinti kártyamárkák logói. */
export function ElfogadottKartyak({ igazitas = 'bal' }: { igazitas?: Igazitas }) {
  return (
    <div
      style={{
        display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap',
        justifyContent: igazitas === 'kozep' ? 'center' : 'flex-start',
      }}
    >
      <span style={{ fontSize: 12 }}>{ELFOGADOTT_KARTYAK_FELIRAT}</span>
      <span style={{ display: 'inline-flex', gap: 6, flexWrap: 'wrap' }}>
        {ELFOGADOTT_KARTYAK.map((k) => {
          const l = KARTYA_LOGOK[k];
          return (
            <span key={k} style={CHIP}>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={l.src} alt={l.nev} width={l.szel} height={l.mag} style={{ display: 'block' }} />
            </span>
          );
        })}
      </span>
    </div>
  );
}
