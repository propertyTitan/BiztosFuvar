'use client';

// "Problemam van ezzel a fuvarral" gomb + modal a vita-nyitashoz.
// Megjelenik a fuvar-detail oldalon a feleknek (shipper vagy carrier),
// in_progress / delivered / completed allapotban.

import React, { useState } from 'react';
import { api } from '@/api';
import { useToast } from './ToastProvider';

type Props = {
  jobId?: string;
  bookingId?: string;
  status: string;
  alreadyOpen?: boolean;
};

const ELIGIBLE_STATUSES = ['in_progress', 'delivered', 'completed'];

export default function DisputeButton({ jobId, bookingId, status, alreadyOpen }: Props) {
  const toast = useToast();
  const [open, setOpen] = useState(false);
  const [description, setDescription] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const eligible = ELIGIBLE_STATUSES.includes(status) && !alreadyOpen;
  if (!eligible) return null;

  const handleSubmit = async () => {
    if (description.trim().length < 20) {
      toast.error('Tul rovid leiras', 'Minimum 20 karakter - ird le mi a problema.');
      return;
    }
    setSubmitting(true);
    try {
      await api.openDispute({
        job_id: jobId,
        booking_id: bookingId,
        description: description.trim(),
      });
      toast.success('Vita megnyitva', 'Egy admin hamarosan ellenorzi es felveszi veled a kapcsolatot.');
      setOpen(false);
      setDescription('');
    } catch (e: any) {
      toast.error('Nem sikerult', e.message);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div>
      <button
        type="button"
        onClick={() => setOpen(true)}
        style={{
          marginTop: 12,
          padding: '8px 14px',
          background: 'transparent',
          border: '1px solid var(--danger)',
          color: 'var(--danger)',
          borderRadius: 8,
          fontWeight: 600,
          fontSize: 13,
          cursor: 'pointer',
        }}
      >
        🚨 Problémám van ezzel a fuvarral
      </button>

      {open ? (
        <div
          onClick={() => setOpen(false)}
          style={{
            position: 'fixed',
            top: 0, left: 0, right: 0, bottom: 0,
            background: 'rgba(0,0,0,0.5)',
            zIndex: 100,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            padding: 16,
          }}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            style={{
              background: 'var(--bg)',
              borderRadius: 12,
              padding: 24,
              maxWidth: 480,
              width: '100%',
              boxShadow: '0 20px 50px rgba(0,0,0,0.3)',
            }}
          >
            <h2 style={{ marginTop: 0, fontSize: 18 }}>Vita megnyitása</h2>
            <p className="muted" style={{ fontSize: 14, marginTop: 0 }}>
              Írd le pontosan, hogy mi a probléma a fuvarral. Egy adminisztrátor 24 órán
              belül megvizsgálja és felveszi veled a kapcsolatot. A vita ideje alatt a
              fizetés (escrow) befagyasztásra kerül.
            </p>
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Pl. A csomag sérülten érkezett, képet csatolok. (min. 20 karakter)"
              maxLength={2000}
              rows={6}
              autoFocus
              style={{
                width: '100%',
                padding: 10,
                fontSize: 14,
                border: '1px solid var(--border)',
                borderRadius: 8,
                background: 'var(--surface)',
                color: 'var(--text)',
                resize: 'vertical',
                marginTop: 8,
              }}
            />
            <div className="muted" style={{ fontSize: 12, marginTop: 4 }}>
              {description.length} / 2000 karakter
            </div>
            <div style={{ display: 'flex', gap: 8, marginTop: 16 }}>
              <button
                type="button"
                onClick={handleSubmit}
                disabled={submitting}
                style={{
                  flex: 1,
                  padding: '10px 16px',
                  background: 'var(--danger)',
                  color: '#fff',
                  fontWeight: 700,
                  border: 'none',
                  borderRadius: 8,
                  cursor: 'pointer',
                  opacity: submitting ? 0.6 : 1,
                }}
              >
                {submitting ? 'Küldés…' : '🚨 Vita megnyitása'}
              </button>
              <button
                type="button"
                onClick={() => setOpen(false)}
                style={{
                  padding: '10px 16px',
                  background: 'var(--surface)',
                  color: 'var(--text)',
                  border: '1px solid var(--border)',
                  borderRadius: 8,
                  cursor: 'pointer',
                }}
              >
                Mégse
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
