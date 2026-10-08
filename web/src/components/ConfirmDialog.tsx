'use client';

// =====================================================================
//  Közös megerősítő / beviteli dialógus — a window.confirm() és
//  window.prompt() márkázott kiváltása.
//
//  - Dizájn-tokenekkel (var(--surface)/--text/--border) → dark mode OK
//  - A dialógus-héj (role=dialog, ESC, fókusz-csapda, fókusz-visszaadás,
//    háttér-kattintás) 2026-10-08 óta a közös <Modal>-ban él — a KYC- és a
//    lefedettségi ablak is azt használja
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

import { ReactNode, useEffect, useState } from 'react';
import FieldError from '@/components/FieldError';
import Modal from '@/components/Modal';
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
  /** Nyitáskor előtöltött értékek (szerkesztő dialógushoz — D3, 2026-09-13) */
  initialValues?: Record<string, string>;
  onConfirm: (values: Record<string, string>) => void;
  onClose: () => void;
};

export default function ConfirmDialog({
  open, title, message, confirmLabel = 'Megerősítés', cancelLabel = 'Mégse',
  danger = false, fields = [], initialValues, onConfirm, onClose,
}: Props) {
  const [values, setValues] = useState<Record<string, string>>({});

  useEffect(() => {
    if (open) setValues(initialValues ? { ...initialValues } : {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const [probaltKuldeni, setProbaltKuldeni] = useState(false);
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
    <Modal open onClose={onClose} ariaLabel={title} zIndex={100000} maxWidth={440}>
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
          {/* GF-FT-07 (Manus): a dialógus fókuszoltan nyílik — mezős
              változatban az első mező (autoFocus), mező nélküliben a
              Mégse gomb kapja, hogy az Enter ne hajtson végre véletlenül
              veszélyes műveletet. */}
          <button type="button" className="btn btn-secondary" onClick={onClose} autoFocus={fields.length === 0}>
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
    </Modal>
  );
}
