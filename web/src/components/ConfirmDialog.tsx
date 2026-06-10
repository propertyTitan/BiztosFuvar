'use client';

// =====================================================================
//  Közös megerősítő / beviteli dialógus — a window.confirm() és
//  window.prompt() márkázott kiváltása.
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

  useEffect(() => {
    if (open) setValues({});
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  if (!open) return null;

  const missingRequired = fields.some((f) => f.required && !(values[f.key] || '').trim());

  const inputStyle = {
    width: '100%',
    padding: '10px 12px',
    borderRadius: 8,
    border: '1px solid #d1d5db',
    fontSize: 14,
    fontFamily: 'inherit',
    background: '#fff',
    color: '#1a1a1a',
    boxSizing: 'border-box' as const,
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={title}
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 99990,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        background: 'rgba(0,0,0,0.6)',
        backdropFilter: 'blur(6px)',
        WebkitBackdropFilter: 'blur(6px)',
      }}
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div
        style={{
          background: '#fff',
          borderRadius: 16,
          padding: 28,
          maxWidth: 440,
          width: '90%',
          boxShadow: '0 20px 60px rgba(0,0,0,0.3)',
          color: '#1a1a1a',
        }}
      >
        <h2 style={{ marginTop: 0, marginBottom: 8, fontSize: 19, fontWeight: 700, color: '#1a1a1a' }}>
          {title}
        </h2>
        {message && (
          <div style={{ fontSize: 14, color: '#555', lineHeight: 1.5, marginBottom: 16 }}>
            {message}
          </div>
        )}

        {fields.map((f) => (
          <label key={f.key} style={{ display: 'block', marginBottom: 14 }}>
            <span style={{ display: 'block', fontSize: 13, fontWeight: 600, marginBottom: 6, color: '#374151' }}>
              {f.label}{f.required ? ' *' : ''}
            </span>
            {f.type === 'textarea' ? (
              <textarea
                value={values[f.key] || ''}
                onChange={(e) => setValues((v) => ({ ...v, [f.key]: e.target.value }))}
                placeholder={f.placeholder}
                rows={3}
                autoFocus={fields[0]?.key === f.key}
                style={{ ...inputStyle, resize: 'vertical' }}
              />
            ) : (
              <input
                type={f.type === 'number' ? 'number' : 'text'}
                value={values[f.key] || ''}
                onChange={(e) => setValues((v) => ({ ...v, [f.key]: e.target.value }))}
                placeholder={f.placeholder}
                autoFocus={fields[0]?.key === f.key}
                style={inputStyle}
              />
            )}
          </label>
        ))}

        <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end', marginTop: 20 }}>
          <button type="button" className="btn btn-secondary" onClick={onClose}>
            {cancelLabel}
          </button>
          <button
            type="button"
            className="btn"
            disabled={missingRequired}
            onClick={() => onConfirm(values)}
            style={{
              background: danger ? '#dc2626' : undefined,
              opacity: missingRequired ? 0.5 : 1,
              cursor: missingRequired ? 'not-allowed' : 'pointer',
            }}
          >
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
