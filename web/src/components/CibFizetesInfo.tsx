// =====================================================================
//  CibFizetesInfo — a fizetési kártya banki kötelező blokkja (CIB PR-3)
//
//  A banki átvételi teszt a fizetési mód kiválasztásának helyén nézi: a
//  CIB-logót a kísérőszöveggel, az elfogadott kártyák logóit, a tájékoztató
//  („Bankkártyás fizetés") és az adatkezelési tájékoztató linkjét, valamint
//  a kereskedő székhelyének országát („a fizetési folyamat legalább egyik
//  oldalán, a vásárló számára jól láthatóan"). Csak CIB-módban jelenik meg —
//  stub-üzemben a mai felület marad.
// =====================================================================
import Link from 'next/link';
import { Lock } from 'lucide-react';
import { CibSzolgaltato, ElfogadottKartyak } from './CibLogok';
import {
  ADATKEZELESI_LINK, BANKKARTYAS_FIZETES_LINK, KARTYAADAT_SOR, KERESKEDO_ORSZAG_SOR,
} from '@/lib/cibFeliratok';

export default function CibFizetesInfo() {
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
      <CibSzolgaltato />
      <ElfogadottKartyak />
      <p style={{ margin: 0, display: 'flex', gap: 6, alignItems: 'flex-start' }}>
        <Lock size={14} style={{ flexShrink: 0, marginTop: 2 }} aria-hidden />
        <span>{KARTYAADAT_SOR}</span>
      </p>
      <p className="muted" style={{ margin: 0, fontSize: 12 }}>{KERESKEDO_ORSZAG_SOR}</p>
      <div style={{ display: 'flex', gap: 14, flexWrap: 'wrap', fontSize: 12 }}>
        <Link href="/bankkartyas-fizetes">{BANKKARTYAS_FIZETES_LINK}</Link>
        <Link href="/adatkezeles">{ADATKEZELESI_LINK}</Link>
      </div>
    </div>
  );
}
