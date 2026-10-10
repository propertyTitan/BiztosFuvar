// =====================================================================
//  CibFizetesInfo — a fizetési kártya banki kötelező blokkja (CIB PR-3)
//
//  A banki átvételi teszt a fizetési mód kiválasztásának helyén nézi: a
//  CIB-logót a kísérőszöveggel, az elfogadott kártyák logóit, a tájékoztató
//  („Bankkártyás fizetés") és az adatkezelési tájékoztató linkjét, valamint
//  a kereskedő székhelyének országát („a fizetési folyamat legalább egyik
//  oldalán, a vásárló számára jól láthatóan"). Csak CIB-módban jelenik meg —
//  stub-üzemben a mai felület marad.
//
//  2026-10-10 (a bank írásos kérése a honlap-teszt után):
//   - a logók helyén a bank EGYBEN szerkesztett logóképe (CibKartyaLogok);
//   - a bank „eCom_CIB.fiz.taj_HU" dokumentumának RÖVID tájékoztatója,
//     SZÓ SZERINT (lib/cibTajekoztato.ts), a záró „Kérjük, olvassa el
//     részletes tájékoztatónkat!" mondat linkként a /bankkartyas-fizetes
//     oldalra. A korábbi saját mondatunk („A kártyaadataidat kizárólag a CIB
//     Bank oldalán adod meg…") kikerült: ugyanezt a banki szöveg mondja el,
//     és nem banki előírás volt.
// =====================================================================
import Link from 'next/link';
import CibKartyaLogok from './CibKartyaLogok';
import { CIB_ROVID_TAJEKOZTATO } from '@/lib/cibTajekoztato';
import {
  ADATKEZELESI_LINK, BANKKARTYAS_FIZETES_LINK, CIB_ADATKEZELESI_LINK, KERESKEDO_ORSZAG_SOR,
} from '@/lib/cibFeliratok';

export default function CibFizetesInfo() {
  const [elso, masodik] = CIB_ROVID_TAJEKOZTATO.bekezdesek;
  return (
    <div
      data-testid="cib-fizetes-info"
      style={{
        marginTop: 12,
        padding: 12,
        borderRadius: 8,
        border: '1px solid var(--border)',
        display: 'flex',
        flexDirection: 'column',
        gap: 10,
        fontSize: 13,
      }}
    >
      <CibKartyaLogok />
      <div data-testid="cib-rovid-tajekoztato" style={{ display: 'flex', flexDirection: 'column', gap: 6, lineHeight: 1.55 }}>
        <p style={{ margin: 0 }}>{elso}</p>
        <p style={{ margin: 0 }}>
          {masodik}{' '}
          <Link href="/bankkartyas-fizetes">{CIB_ROVID_TAJEKOZTATO.reszletesLink}</Link>
        </p>
      </div>
      <p className="muted" style={{ margin: 0, fontSize: 12 }}>{KERESKEDO_ORSZAG_SOR}</p>
      <div style={{ display: 'flex', gap: 14, flexWrap: 'wrap', fontSize: 12 }}>
        <Link href="/bankkartyas-fizetes">{BANKKARTYAS_FIZETES_LINK}</Link>
        {/* 2026-10-01 (a PR-4 1. javítóköre, WCAG 2.4.4): a kártyán a
            nyilatkozat azonos nevű linkje is ide mutat — azonos név, azonos
            cél: a tájékoztató bankkártyás (CIB) szakasza. */}
        <Link href={CIB_ADATKEZELESI_LINK.href}>{ADATKEZELESI_LINK}</Link>
      </div>
    </div>
  );
}
