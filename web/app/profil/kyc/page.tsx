'use client';

// Web KYC oldal — paritás a mobil `app/kyc.tsx`-szel.
// - Mutatja az aktuális státuszt + a legutóbbi feltöltött doksit
// - Lehetővé teszi új jogosítvány-fotó feltöltését manuális adatokkal
// - Sikeres feltöltés után kyc_status → 'pending' (admin jóváhagyásig)
import { useEffect, useState } from 'react';
import Link from 'next/link';
import { api, KycMe, KycStatus } from '@/api';
import { useToast } from '@/components/ToastProvider';

const STATUS_LABEL: Record<KycStatus, { label: string; color: string }> = {
  none:      { label: 'Nincs feltöltve', color: '#64748B' },
  pending:   { label: 'Ellenőrzés alatt', color: '#F59E0B' },
  verified:  { label: 'Hitelesítve',      color: '#16A34A' },
  suspended: { label: 'Felfüggesztve',     color: '#DC2626' },
};

function validDate(s: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
  const d = new Date(s);
  if (Number.isNaN(d.getTime())) return false;
  const today = new Date(); today.setHours(0, 0, 0, 0);
  return d >= today;
}

export default function KycPage() {
  const toast = useToast();
  const [kyc, setKyc] = useState<KycMe | null>(null);
  const [loading, setLoading] = useState(true);

  const [file, setFile] = useState<File | null>(null);
  const [docNumber, setDocNumber] = useState('');
  const [fullName, setFullName] = useState('');
  const [expiry, setExpiry] = useState('');
  const [submitting, setSubmitting] = useState(false);

  async function load() {
    setLoading(true);
    try {
      const r = await api.getKycStatus();
      setKyc(r);
      if (r.document) {
        setFullName(r.document.full_name_on_doc || '');
        setDocNumber(r.document.doc_number || '');
        if (r.document.expiry_date) setExpiry(r.document.expiry_date.slice(0, 10));
      }
    } catch (e: any) {
      toast.error('Hiba', e.message);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { load(); }, []);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!file) {
      toast.error('Fotó hiányzik', 'Tölts fel egy fotót a jogosítványról.');
      return;
    }
    if (!validDate(expiry)) {
      toast.error('Lejárati dátum', 'YYYY-MM-DD, csak jövőbeli dátum.');
      return;
    }
    setSubmitting(true);
    try {
      await api.uploadLicense({
        file,
        docNumber: docNumber.trim() || undefined,
        fullName: fullName.trim() || undefined,
        expiryDate: expiry,
      });
      toast.success('Jogosítvány feltöltve', 'Admin jóváhagyás folyamatban.');
      setFile(null);
      load();
    } catch (e: any) {
      toast.error('Sikertelen feltöltés', e.message);
    } finally {
      setSubmitting(false);
    }
  }

  if (loading) {
    return <p>Betöltés…</p>;
  }

  const statusInfo = STATUS_LABEL[kyc?.kyc_status || 'none'];
  const doc = kyc?.document;

  return (
    <div style={{ maxWidth: 720, margin: '0 auto', padding: '24px 16px' }}>
      <div style={{ marginBottom: 16 }}>
        <Link href="/profil" style={{ color: 'var(--muted)', textDecoration: 'none' }}>← Vissza a profilra</Link>
      </div>

      <h1 style={{ marginTop: 0 }}>Jogosítvány hitelesítés</h1>

      {/* Státusz kártya */}
      <div
        style={{
          background: 'var(--surface)',
          border: '1px solid var(--border)',
          borderRadius: 12,
          padding: 16,
          marginBottom: 24,
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
          <span
            style={{
              display: 'inline-block', width: 10, height: 10, borderRadius: 5,
              background: statusInfo.color,
            }}
          />
          <strong style={{ color: statusInfo.color, fontSize: 16 }}>{statusInfo.label}</strong>
        </div>
        {kyc?.license_expiry && (
          <p className="muted" style={{ margin: 0 }}>
            Lejárat: {new Date(kyc.license_expiry).toLocaleDateString('hu-HU')}
          </p>
        )}

        {doc?.status === 'rejected' && (
          <div
            style={{
              marginTop: 12, padding: 12, background: '#FEE2E2',
              borderRadius: 8, color: '#991B1B',
            }}
          >
            <strong>⚠️ Az előző feltöltés elutasítva</strong>
            {doc.rejection_reason && (
              <div style={{ fontSize: 13, marginTop: 4 }}>Indok: {doc.rejection_reason}</div>
            )}
          </div>
        )}
        {kyc?.kyc_status === 'pending' && (
          <div
            style={{
              marginTop: 12, padding: 12, background: '#DBEAFE',
              borderRadius: 8, color: '#1E3A8A', fontSize: 13,
            }}
          >
            ⏳ Az adminok rövidesen átnézik. Erről értesítést is kapsz.
          </div>
        )}
        {kyc && !kyc.can_bid && (
          <div
            style={{
              marginTop: 12, padding: 12, background: '#FEF3C7',
              borderRadius: 8, color: '#92400E', fontSize: 13, fontWeight: 700,
            }}
          >
            🚫 Licitálás letiltva. Tölts fel érvényes jogosítványt.
          </div>
        )}
      </div>

      {/* Feltöltő űrlap */}
      <h2 style={{ marginBottom: 4 }}>Új jogosítvány feltöltése</h2>
      <p className="muted" style={{ marginTop: 0, marginBottom: 16 }}>
        Készíts éles fotót a jogosítványod elülső oldaláról. A nevet, az okmányszámot és a
        lejárati dátumot úgy add meg, ahogy a kártyán szerepel.
      </p>

      <form onSubmit={submit} style={{ display: 'grid', gap: 12 }}>
        <label style={{ display: 'block' }}>
          <span style={{ display: 'block', marginBottom: 4, fontWeight: 600 }}>Jogosítvány fotója</span>
          <input
            type="file"
            accept="image/*"
            onChange={(e) => setFile(e.target.files?.[0] || null)}
            required
          />
        </label>

        <label style={{ display: 'block' }}>
          <span style={{ display: 'block', marginBottom: 4, fontWeight: 600 }}>
            Név (a jogosítványon szereplő)
          </span>
          <input
            type="text"
            value={fullName}
            onChange={(e) => setFullName(e.target.value)}
            placeholder="Pl. Kovács János"
            style={{ width: '100%', padding: '10px 12px', border: '1px solid var(--border)', borderRadius: 8 }}
          />
        </label>

        <label style={{ display: 'block' }}>
          <span style={{ display: 'block', marginBottom: 4, fontWeight: 600 }}>Okmányszám</span>
          <input
            type="text"
            value={docNumber}
            onChange={(e) => setDocNumber(e.target.value.toUpperCase())}
            placeholder="Pl. AB123456"
            style={{ width: '100%', padding: '10px 12px', border: '1px solid var(--border)', borderRadius: 8 }}
          />
        </label>

        <label style={{ display: 'block' }}>
          <span style={{ display: 'block', marginBottom: 4, fontWeight: 600 }}>
            Lejárati dátum (YYYY-MM-DD)
          </span>
          <input
            type="date"
            value={expiry}
            onChange={(e) => setExpiry(e.target.value)}
            required
            style={{ width: '100%', padding: '10px 12px', border: '1px solid var(--border)', borderRadius: 8 }}
          />
        </label>

        <button
          type="submit"
          disabled={submitting}
          style={{
            marginTop: 12,
            padding: '12px 16px',
            background: 'var(--success)',
            color: '#fff',
            fontWeight: 800,
            fontSize: 15,
            border: 'none',
            borderRadius: 8,
            cursor: submitting ? 'wait' : 'pointer',
            opacity: submitting ? 0.6 : 1,
          }}
        >
          {submitting ? 'Feltöltés…' : 'Feltöltés és beküldés ellenőrzésre'}
        </button>
      </form>
    </div>
  );
}
