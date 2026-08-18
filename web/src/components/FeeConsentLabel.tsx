'use client';

// =====================================================================
//  A 45/2014. 29. § (1) a) CONSENT-LABEL — közös komponens
//
//  ⚠️ MIÉRT LÉTEZIK (2026-08-18, tesztelői képernyőkép + mobil-session
//  diagnózis): a tesztelőnél a consent-doboz több száz pixel magasra nyúlt,
//  a szöveg pedig egy ~1 karakter széles oszlopban, BETŰNKÉNT TÖRVE,
//  függőlegesen jelent meg. Két tényező együtt okozta:
//
//   1. a `.card { overflow-wrap: anywhere }` (globals.css) a kártya minden
//      szövegére öröklődik, és az `anywhere` a szöveg MIN-CONTENT szélességét
//      ~1 karakterre csökkenti (ez szándékos — a cím+pill sorokat védi,
//      NEM szabad kivenni);
//   2. a label `display: flex`, de a szöveg-<span>-en nem volt explicit
//      flex-szabály (default `0 1 auto`) — így a span szélessége a
//      tartalomtól függött, és egyes böngésző-motorok a min-content-re
//      (≈1 betű) ejtették le. Asztali Chrome-ban NEM reprodukálódik —
//      motorfüggő viselkedés.
//
//  A `flex: '1 1 0%'` + `minWidth: 0` determinisztikussá teszi: a span
//  szélessége a SZABAD HELYBŐL számolódik (konténer − checkbox − gap), nem a
//  tartalom min-szélességéből — minden motoron.
//
//  ⚠️ És AZÉRT KÖZÖS KOMPONENS, mert a markup pontosan ugyanígy KÉT helyen
//  élt (fuvar-fizetés + foglalás-fizetés) — a javítás fél-oldalon megépülése
//  ellen a legjobb védelem, ha nincs második oldal. A jogi szöveg egyetlen
//  forrásból jön, tehát a két fizetési ág nyilatkozata nem is csúszhat szét.
// =====================================================================
import type { ReactNode } from 'react';

type Props = {
  checked: boolean;
  onChange: (checked: boolean) => void;
  /**
   * Az ág-specifikus záró mondat. A fuvar-ágon a díjmentes szállító-csere
   * ígérete szerepel; a foglalás-ágon rövidebb a szöveg. Ha üres, csak a
   * közös jogi mag jelenik meg.
   */
  zaroMondat?: ReactNode;
};

export default function FeeConsentLabel({ checked, onChange, zaroMondat }: Props) {
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
      {/* Explicit méret is (öv + nadrágtartó): a globális `input { width:
          100% }` alól a checkbox már kivétel, de ha az a szabály valaha
          visszaváltozik, ez a sor önmagában is megfogja — a 492 px széles
          checkbox volt a betűnkénti törés valódi oka. */}
      <input
        type="checkbox"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
        style={{ marginTop: 3, flexShrink: 0, width: 16, height: 16 }}
      />
      <span data-testid="fee-consent-szoveg" style={{ flex: '1 1 0%', minWidth: 0 }}>
        Kérem a szolgáltatás (kapcsolatfelvételi adatok átadása){' '}
        <strong>azonnali teljesítését</strong>, és tudomásul veszem, hogy a
        teljesítés után <strong>elállási jogomat elvesztem</strong>{' '}
        (45/2014. Korm. rendelet 29. § (1) a)). A díj nem visszatérítendő
        {zaroMondat ? <>{'; '}{zaroMondat}</> : '.'}
      </span>
    </label>
  );
}
