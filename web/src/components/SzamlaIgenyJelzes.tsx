'use client';

// =====================================================================
//  „A FELADÓ SZÁMLÁT KÉR" — jelzés a szállítónak (2026-08-15, tesztelő)
//
//  A tesztelő észrevétele: „bepipáltam, hogy kérek számlát — az nem jelenik
//  meg se a szállító, se a feladó számára."
//
//  Igaz volt: az `invoice_requested` a fuvarfeladáskor MENTŐDÖTT, el is jutott
//  a böngészőig — de SEHOL nem renderelte semmi. A pipa egy zsákutca volt.
//
//  ⚠️ ÉS EZ NEM KOZMETIKA. A kápés modellben a fuvardíjról a SZÁLLÍTÓ állít ki
//  számlát, nem a platform (mi csak a kapcsolatfelvételi díjról számlázunk).
//  Egy magánszemély szállító viszont NEM TUD számlát adni. Ha ez nem látszik
//  ajánlattétel ELŐTT, a hiány az átadásnál derül ki — amikor a csomag már ott
//  van, és mindkét fél rosszul jár.
//
//  Ezért a szállítónak ez FIGYELMEZTETÉS (sárga), a feladónak visszaigazolás.
// =====================================================================
import { FileText } from 'lucide-react';

type Props = {
  /** Kér-e a feladó számlát a fuvardíjról? */
  kert?: boolean | null;
  /** 'szallito': figyelmeztetés · 'felado': visszaigazolás a saját kéréséről. */
  nezet: 'szallito' | 'felado';
};

export default function SzamlaIgenyJelzes({ kert, nezet }: Props) {
  if (!kert) return null;

  const szallitoNezet = nezet === 'szallito';

  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'flex-start',
        gap: 10,
        padding: '10px 12px',
        margin: '12px 0',
        borderRadius: 8,
        fontSize: 14,
        background: szallitoNezet ? 'rgba(217,119,6,0.12)' : 'rgba(37,99,235,0.08)',
        border: `1px solid ${szallitoNezet ? 'rgba(217,119,6,0.45)' : 'rgba(37,99,235,0.30)'}`,
      }}
    >
      <FileText size={17} style={{ flexShrink: 0, marginTop: 2 }} />
      <div>
        <strong>
          {szallitoNezet ? 'A feladó számlát kér a fuvardíjról' : 'Számlát kértél a fuvardíjról'}
        </strong>
        <div style={{ marginTop: 2 }}>
          {szallitoNezet ? (
            <>
              A fuvardíjról <strong>neked</strong> kell számlát adnod — a GoFuvar csak
              a kapcsolatfelvételi díjról számláz. Ha magánszemélyként vállalsz
              fuvart és nem tudsz számlát kiállítani, erre a fuvarra ne tegyél
              ajánlatot.
            </>
          ) : (
            <>
              A fuvardíjról a <strong>szállító</strong> állítja ki a számlát, nem a
              GoFuvar — mi csak a kapcsolatfelvételi díjról számlázunk. A jelzést a
              szállítók az ajánlattétel előtt látják.
            </>
          )}
        </div>
      </div>
    </div>
  );
}
