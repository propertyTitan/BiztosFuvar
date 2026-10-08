'use client';

// =====================================================================
//  SegmentedControl — „egy a kettő/három közül" kapcsoló (UX A29, 2026-10-08)
//
//  A Magánszemély/Cég, a Lista/Térkép és a Feladó/Szállító mód kapcsolója
//  eddig sima gomb volt, állapot nélkül (vagy aria-pressed-del, ami „be/ki"
//  kapcsolót jelent, nem „egyet a többi közül"): a felolvasó nem mondta meg,
//  melyik van kiválasztva, és a „Fiók típusa" címke semmihez nem volt kötve.
//
//  Most: role="radiogroup" + role="radio" + aria-checked, a csoport neve a
//  látható címkéből (aria-labelledby) vagy aria-label-ből jön; billentyűzettel
//  a rádiócsoport szabványa szerint — Tab a KIVÁLASZTOTT elemre lép (a többi
//  tabIndex=-1), a nyilak (és Home/End) választanak és fókuszt visznek.
// =====================================================================
import { useRef, type CSSProperties, type KeyboardEvent, type ReactNode } from 'react';

export type SegmentedOpcio<T extends string> = {
  ertek: T;
  felirat: ReactNode;
  /** lucide ikon (aria-hidden-nel) a felirat előtt */
  ikon?: ReactNode;
};

type Props<T extends string> = {
  opciok: SegmentedOpcio<T>[];
  ertek: T;
  onValtozas: (ertek: T) => void;
  /** A csoport neve — vagy ez, vagy a cimkeId kötelező. */
  ariaLabel?: string;
  /** Egy látható címke id-je (aria-labelledby). */
  cimkeId?: string;
  /** 'kitoltott': kék kitöltés (fülek, fióktípus, mód) · 'pirula': világos pirula (nézet). */
  valtozat?: 'kitoltott' | 'pirula';
  style?: CSSProperties;
  gombStilus?: CSSProperties;
};

export default function SegmentedControl<T extends string>({
  opciok, ertek, onValtozas, ariaLabel, cimkeId, valtozat = 'kitoltott', style, gombStilus,
}: Props<T>) {
  const gombok = useRef<(HTMLButtonElement | null)[]>([]);

  function lep(index: number) {
    const n = opciok.length;
    const i = ((index % n) + n) % n;
    onValtozas(opciok[i].ertek);
    gombok.current[i]?.focus();
  }

  function onKeyDown(e: KeyboardEvent<HTMLButtonElement>, index: number) {
    switch (e.key) {
      case 'ArrowRight':
      case 'ArrowDown':
        e.preventDefault(); lep(index + 1); break;
      case 'ArrowLeft':
      case 'ArrowUp':
        e.preventDefault(); lep(index - 1); break;
      case 'Home':
        e.preventDefault(); lep(0); break;
      case 'End':
        e.preventDefault(); lep(opciok.length - 1); break;
      default:
    }
  }

  const kitoltott = valtozat === 'kitoltott';
  return (
    <div
      role="radiogroup"
      aria-label={cimkeId ? undefined : ariaLabel}
      aria-labelledby={cimkeId}
      style={{
        display: kitoltott ? 'flex' : 'inline-flex',
        gap: kitoltott ? 4 : 0,
        background: kitoltott ? 'var(--surface)' : 'var(--bg)',
        borderRadius: kitoltott ? 12 : 999,
        padding: kitoltott ? 4 : 3,
        border: '1px solid var(--border)',
        ...style,
      }}
    >
      {opciok.map((o, i) => {
        const aktiv = o.ertek === ertek;
        return (
          <button
            key={o.ertek}
            ref={(el) => { gombok.current[i] = el; }}
            type="button"
            role="radio"
            aria-checked={aktiv}
            tabIndex={aktiv ? 0 : -1}
            onClick={() => onValtozas(o.ertek)}
            onKeyDown={(e) => onKeyDown(e, i)}
            style={kitoltott ? {
              flex: 1, padding: '10px 0', borderRadius: 10, border: 'none',
              fontWeight: 700, fontSize: 14, cursor: 'pointer', transition: 'all 0.15s',
              background: aktiv ? 'var(--primary)' : 'transparent',
              color: aktiv ? '#fff' : 'var(--muted)',
              display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 6,
              minHeight: 40,
              ...gombStilus,
            } : {
              display: 'inline-flex', alignItems: 'center', gap: 6,
              padding: '8px 12px', minHeight: 40, borderRadius: 999, border: 'none',
              background: aktiv ? 'var(--surface)' : 'transparent',
              fontWeight: aktiv ? 700 : 500, cursor: 'pointer', fontSize: 13, color: 'var(--text)',
              boxShadow: aktiv ? '0 1px 3px rgba(0,0,0,0.1)' : 'none',
              ...gombStilus,
            }}
          >
            {o.ikon}
            {o.felirat}
          </button>
        );
      })}
    </div>
  );
}
