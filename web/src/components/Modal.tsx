'use client';

// =====================================================================
//  Közös dialógus-héj (UX-review A29, 2026-10-08).
//
//  A ConfirmDialog már tudta, amit egy párbeszédablaknak tudnia kell
//  (role=dialog + aria-modal, Escape, fókuszcsapda, a fókusz visszaadása a
//  hívó gombnak, a szöveg-kijelölés nem zárja be). A KYC- és a lefedettségi
//  ablak viszont sima <div> volt: nem volt dialógus a felolvasónak, az Escape
//  nem zárta, és a háttér tabbal bejárható maradt. A héj most EGY helyen él,
//  mindhárom ezt használja.
//
//  - csak a LEGFELSŐ nyitott ablak reagál az Escape-re és a Tab-ra
//    (egymásra nyíló ablakoknál az alsó nem záródik be véletlenül);
//  - nyitáskor a fókusz az ablakba kerül (ha egy mező autoFocus-szal már
//    benne van, azt meghagyjuk), záráskor visszakerül a hívó elemre;
//  - a háttérre kattintás csak akkor zár, ha a lenyomás ÉS a felengedés is
//    a háttéren történt (a dialógusban kezdett szöveg-kijelölés nem zár be).
// =====================================================================

import { CSSProperties, ReactNode, useEffect, useRef } from 'react';
import { X } from 'lucide-react';

const FOKUSZALHATO = 'a[href], button:not([disabled]), input:not([disabled]):not([type="hidden"]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

// A nyitott ablakok verme — a billentyűkezelés csak a legfelsőre hat.
const nyitottak: symbol[] = [];

export type ModalProps = {
  open: boolean;
  onClose: () => void;
  /** Akadálymentes név, ha nincs látható címsor-azonosító. */
  ariaLabel?: string;
  /** A látható címsor id-je (aria-labelledby). */
  labelledBy?: string;
  children: ReactNode;
  maxWidth?: number;
  zIndex?: number;
  /** Jobb felső bezáró gomb (lucide X, 44 px-es érintési felület). */
  closeButton?: boolean;
  closeLabel?: string;
  panelStyle?: CSSProperties;
};

export default function Modal({
  open, onClose, ariaLabel, labelledBy, children, maxWidth = 440, zIndex = 100000,
  closeButton = false, closeLabel = 'Bezárás', panelStyle,
}: ModalProps) {
  const panelRef = useRef<HTMLDivElement>(null);
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;
  // Hol kezdődött az utolsó egérgomb-lenyomás? (lásd a háttér kommentjét)
  const hatterenNyomtak = useRef(false);

  useEffect(() => {
    if (!open) return;
    const azon = Symbol('modal');
    nyitottak.push(azon);
    const hivo = document.activeElement as HTMLElement | null;
    const panel = panelRef.current;
    if (panel && !panel.contains(document.activeElement)) panel.focus();
    const legfelso = () => nyitottak[nyitottak.length - 1] === azon;

    const onKey = (e: KeyboardEvent) => {
      if (!legfelso()) return;
      if (e.key === 'Escape') { onCloseRef.current(); return; }
      if (e.key !== 'Tab') return;
      const p = panelRef.current;
      if (!p) return;
      const lista = Array.from(p.querySelectorAll<HTMLElement>(FOKUSZALHATO))
        .filter((el) => el.tabIndex >= 0 && !el.closest('[hidden]'));
      if (lista.length === 0) { e.preventDefault(); p.focus(); return; }
      const elso = lista[0];
      const utolso = lista[lista.length - 1];
      const aktiv = document.activeElement;
      if (!p.contains(aktiv)) {
        e.preventDefault();
        (e.shiftKey ? utolso : elso).focus();
      } else if (e.shiftKey && (aktiv === elso || aktiv === p)) {
        e.preventDefault(); utolso.focus();
      } else if (!e.shiftKey && aktiv === utolso) {
        e.preventDefault(); elso.focus();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('keydown', onKey);
      const i = nyitottak.indexOf(azon);
      if (i >= 0) nyitottak.splice(i, 1);
      if (hivo && typeof hivo.focus === 'function' && document.contains(hivo)) hivo.focus();
    };
  }, [open]);

  if (!open) return null;

  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        zIndex,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: 16,
        background: 'rgba(2, 6, 23, 0.6)',
        backdropFilter: 'blur(6px)',
        WebkitBackdropFilter: 'blur(6px)',
        animation: 'gofuvar-fade-in 0.2s ease-out',
      }}
      // ⚠️ NEM elég a puszta onClick (2026-08-20, tesztelői észrevétel): a
      // `click` ott sül el, ahol az egérgombot FELENGEDIK. Aki a dialóguson
      // BELÜL kezd szöveget kijelölni, és a háttér fölött engedi el, annak a
      // kattintás a háttéren csattan. Ezért csak akkor zárunk, ha a lenyomás
      // ÉS a felengedés is a háttéren történt.
      onMouseDown={(e) => { hatterenNyomtak.current = e.target === e.currentTarget; }}
      onClick={(e) => {
        if (e.target === e.currentTarget && hatterenNyomtak.current) onClose();
        hatterenNyomtak.current = false;
      }}
    >
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-label={labelledBy ? undefined : ariaLabel}
        aria-labelledby={labelledBy}
        tabIndex={-1}
        style={{
          position: 'relative',
          background: 'var(--surface)',
          color: 'var(--text)',
          borderRadius: 'var(--radius-lg)',
          border: '1px solid var(--border)',
          padding: 28,
          maxWidth,
          width: '100%',
          maxHeight: 'calc(100dvh - 32px)',
          overflowY: 'auto',
          boxShadow: 'var(--shadow-lg)',
          outline: 'none',
          ...panelStyle,
        }}
      >
        {closeButton && (
          <button
            type="button"
            onClick={onClose}
            aria-label={closeLabel}
            style={{
              position: 'absolute', top: 6, right: 6, width: 44, height: 44,
              display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
              background: 'transparent', border: 'none', borderRadius: 999,
              color: 'var(--muted)', cursor: 'pointer', padding: 0,
            }}
          >
            <X size={22} aria-hidden />
          </button>
        )}
        {children}
      </div>
    </div>
  );
}
