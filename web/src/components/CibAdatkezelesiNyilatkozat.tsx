'use client';

// =====================================================================
//  A CIB FELÉ TÖRTÉNŐ ADATTOVÁBBÍTÁSI NYILATKOZAT — jelölőnégyzet
//  (2026-10-01, a CIB írásos válasza)
//
//  A bank a kártyás fizetéshez KÖTELEZŐVÉ teszi az adattovábbítási
//  hozzájárulást, akkor is, ha vásárlói adatot (név, cím, e-mail) nem
//  küldünk. Ezért CIB-módban egy KÜLÖN, előre ki nem pipált jelölőnégyzet
//  jelenik meg a 45/2014-es nyilatkozat (FeeConsentLabel) mellett — azt nem
//  helyettesíti, és nem is olvad bele.
//
//  A szöveg SZÓ SZERINT a bank által kért mondat (CIB_ADATKEZELESI_NYILATKOZAT
//  egy forrásból); az „Adatkezelési tájékoztató" rész a tájékoztató CIB-
//  szakaszára mutató link. A tördelés a FeeConsentLabel bevált mintája (a
//  span a szabad helyből számol — a 2026-08-18-i betűnkénti törés ellen).
// =====================================================================
import Link from 'next/link';
import { CIB_ADATKEZELESI_LINK, CIB_ADATKEZELESI_NYILATKOZAT } from '@/lib/cibFeliratok';

type Props = {
  checked: boolean;
  onChange: (checked: boolean) => void;
};

// A mondat a link előtti és utáni részre bontva — a megjelenített szöveg így
// betűre a konstans marad (a link a mondat része, nem utána fűzött elem).
const LINK_HELYE = CIB_ADATKEZELESI_NYILATKOZAT.indexOf(CIB_ADATKEZELESI_LINK.szoveg);
const ELOTTE = CIB_ADATKEZELESI_NYILATKOZAT.slice(0, LINK_HELYE);
const UTANA = CIB_ADATKEZELESI_NYILATKOZAT.slice(LINK_HELYE + CIB_ADATKEZELESI_LINK.szoveg.length);

export default function CibAdatkezelesiNyilatkozat({ checked, onChange }: Props) {
  return (
    <label
      style={{
        display: 'flex',
        gap: 10,
        alignItems: 'flex-start',
        fontSize: 13,
        lineHeight: 1.5,
        padding: 12,
        borderRadius: 8,
        border: '1px solid var(--border)',
        marginTop: 12,
        cursor: 'pointer',
      }}
    >
      <input
        type="checkbox"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
        style={{ marginTop: 3, flexShrink: 0, width: 16, height: 16 }}
      />
      <span data-testid="cib-adatkezelesi-szoveg" style={{ flex: '1 1 0%', minWidth: 0 }}>
        {ELOTTE}
        <Link href={CIB_ADATKEZELESI_LINK.href} target="_blank" rel="noopener">
          {CIB_ADATKEZELESI_LINK.szoveg}
        </Link>
        {UTANA}
      </span>
    </label>
  );
}
