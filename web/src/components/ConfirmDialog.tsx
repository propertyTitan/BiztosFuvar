'use client';

// =====================================================================
//  Közös megerősítő / beviteli dialógus — a window.confirm() és
//  window.prompt() márkázott kiváltása.
//
//  - Dizájn-tokenekkel (var(--surface)/--text/--border) → dark mode OK
//  - Fókusz-csapda: Tab a dialóguson belül marad, ESC zár, nyitáskor
//    a dialógus kapja a fókuszt, záráskor visszaadjuk a hívó gombnak
//  - Enter a confirm gombot nyomja (textarea-ban újsor marad)
//
//  Használat:
//    <ConfirmDialog
//      open={!!dialog}
//      title="Fuvar lemondása"
//      message="Biztosan lemondod? A lemondási díjat levonjuk."
//      danger
//      fields={[{ key: 'reason', label: 'Indoklás', type: 'textarea', required: true }]}
//      onConfirm={(v) => doCancel(v.reason)}
//      onClose={() => setDialog(null)}
//    />
// =====================================================================

import { ReactNode, useEffect, useRef, useState } from 'react';
import FieldError from '@/components/FieldError';
import { sanitizeNumericInput } from '@/lib/formValidation';

export type DialogField = {
  key: string;
  label: string;
  type?: 'text' | 'textarea' | 'number';
  placeholder?: string;
  required?: boolean;
};

type Props = {
  open: boolean;
  title: string;
  message?: ReactNode;
  confirmLabel?: string;
  cancelLabel?: string;
  /** Piros megerősítő gomb destruktív műveletekhez */
  danger?: boolean;
  /** Opcionális beviteli mezők — az onConfirm kulcs→érték párokat kap */
  fields?: DialogField[];
  onConfirm: (values: Record<string, string>) => void;
  onClose: () => void;
};

export default function ConfirmDialog({
  open, title, message, confirmLabel = 'Megerősítés', cancelLabel = 'Mégse',
  danger = false, fields = [], onConfirm, onClose,
}: Props) {
  const [values, setValues] = useState<Record<string, string>>({});
  const dialogRef = useRef<HTMLDivElement>(null);
  const openerRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    if (open) setValues({});
  }, [open]);

  // Fókusz-kezelés: megjegyezzük a hívó elemet, a dialógusra fókuszálunk,
  // záráskor visszaadjuk a fókuszt.
  useEffect(() => {
    if (!open) return;
    openerRef.current = document.activeElement as HTMLElement | null;
    const first = dialogRef.current?.querySelector<HTMLElement>(
      'input, textarea, button',
    );
    (first || dialogRef.current)?.focus();
    return () => { openerRef.current?.focus?.(); };
  }, [open]);

  // ESC zár + Tab fókusz-csapda a dialóguson belül
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { onClose(); return; }
      if (e.key !== 'Tab') return;
      const focusables = dialogRef.current?.querySelectorAll<HTMLElement>(
        'input, textarea, button, [href], [tabindex]:not([tabindex="-1"])',
      );
      if (!focusables || focusables.length === 0) return;
      const list = Array.from(focusables).filter((el) => !el.hasAttribute('disabled'));
      const firstEl = list[0];
      const lastEl = list[list.length - 1];
      if (e.shiftKey && document.activeElement === firstEl) {
        e.preventDefault(); lastEl.focus();
      } else if (!e.shiftKey && document.activeElement === lastEl) {
        e.preventDefault(); firstEl.focus();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  const [probaltKuldeni, setProbaltKuldeni] = useState(false);
  // Hol kezdődött az utolsó egérgomb-lenyomás? (lásd a backdrop kommentjét)
  const hatterenNyomtak = useRef(false);
  if (!open) return null;

  const missingRequired = fields.some((f) => f.required && !(values[f.key] || '').trim());
  // Szám-mezőn a 0 és a negatív nem elfogadható (az ellenajánlat összege is
  // ezen az úton jön) — eddig a gomb csak NÉMÁN nem csinált semmit.
  const rosszSzam = fields.some((f) => f.type === 'number'
    && (values[f.key] || '').trim() !== ''
    && !(Number(values[f.key]) > 0));

  function submit() {
    if (missingRequired || rosszSzam) {
      // A hibák mostantól LÁTHATÓAK a mezők alatt, nem csak a gomb tiltásában.
      setProbaltKuldeni(true);
      return;
    }
    onConfirm(values);
  }

  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 100000,
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
      // `click` esemény ott sül el, ahol az egérgombot FELENGEDIK. Aki a
      // dialóguson BELÜL kezd szöveget kijelölni (pl. az ellenajánlat
      // összegét), és a húzást a háttér fölött engedi el, annak a kattintás
      // a háttéren csattan — és a dialógus a beírt adatával együtt eltűnt.
      // Ezért csak akkor zárunk, ha a lenyomás ÉS a felengedés is a
      // háttéren történt.
      onMouseDown={(e) => { hatterenNyomtak.current = e.target === e.currentTarget; }}
      onClick={(e) => {
        if (e.target === e.currentTarget && hatterenNyomtak.current) onClose();
        hatterenNyomtak.current = false;
      }}
    >
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        tabIndex={-1}
        style={{
          background: 'var(--surface)',
          color: 'var(--text)',
          borderRadius: 'var(--radius-lg)',
          border: '1px solid var(--border)',
          padding: 28,
          maxWidth: 440,
          width: '100%',
          boxShadow: 'var(--shadow-lg)',
          outline: 'none',
        }}
      >
        <h2 style={{ marginTop: 0, marginBottom: 8, fontSize: 20, fontWeight: 700 }}>
          {title}
        </h2>
        {message && (
          <div style={{ fontSize: 14, color: 'var(--text-secondary)', lineHeight: 1.5, marginBottom: 16 }}>
            {message}
          </div>
        )}

        {fields.map((f, i) => (
          <label key={f.key} style={{ display: 'block', marginTop: 0, marginBottom: 14 }}>
            <span style={{ display: 'block', fontSize: 13, fontWeight: 600, marginBottom: 6, color: 'var(--text-secondary)' }}>
              {f.label}{f.required ? ' *' : ''}
            </span>
            {f.type === 'textarea' ? (
              <textarea
                className="input"
                value={values[f.key] || ''}
                onChange={(e) => setValues((v) => ({ ...v, [f.key]: e.target.value }))}
                placeholder={f.placeholder}
                rows={3}
                autoFocus={i === 0}
                style={{ resize: 'vertical', marginTop: 0 }}
              />
            ) : (
              <input
                className="input"
                type={f.type === 'number' ? 'number' : 'text'}
                inputMode={f.type === 'number' ? 'numeric' : undefined}
                min={f.type === 'number' ? 0 : undefined}
                value={values[f.key] || ''}
                onChange={(e) => setValues((v) => ({
                  ...v,
                  // ⚠️ Szám-mezőn a mínuszjel BE SEM ÍRHATÓ (tesztelői
                  // észrevétel, 2026-08-15). A dialógus adja az ELLENAJÁNLAT
                  // összegét is — egy negatív ellenajánlat értelmetlen, és a
                  // `min` attribútum önmagában csak a natív űrlap-ellenőrzésnél
                  // szólna, gépelés közben nem.
                  [f.key]: f.type === 'number'
                    ? sanitizeNumericInput(e.target.value)
                    : e.target.value,
                }))}
                onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); submit(); } }}
                placeholder={f.placeholder}
                autoFocus={i === 0}
                style={{ marginTop: 0 }}
              />
            )}
            {/* Mezőszintű magyarázat — a felhasználó lássa, MIÉRT nem enged
                tovább a gomb (tesztelői kérés: egységes hibajelzés). */}
            <FieldError>
              {probaltKuldeni && f.required && !(values[f.key] || '').trim()
                ? `Kérjük, töltsd ki: ${f.label}.`
                : (probaltKuldeni && f.type === 'number' && (values[f.key] || '').trim() !== ''
                  && !(Number(values[f.key]) > 0)
                  ? `${f.label}: 0-nál nagyobb számot adj meg.`
                  : null)}
            </FieldError>
          </label>
        ))}

        <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end', marginTop: 20 }}>
          <button type="button" className="btn btn-secondary" onClick={onClose}>
            {cancelLabel}
          </button>
          <button
            type="button"
            className={danger ? 'btn btn-danger' : 'btn'}
            disabled={missingRequired}
            onClick={submit}
            style={missingRequired ? { opacity: 0.5, cursor: 'not-allowed' } : undefined}
          >
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
