'use client';

// DAC7 adóazonosító-bekérő kártya (Vinted-minta): CSAK akkor jelenik meg,
// ha a magánszemély szállító már teljesített fuvart (a backend beállította
// a bekérést — me.tax_data.needed), de még nem adta meg az adatait.
// A 60 napos határidő lejárta után (me.tax_data.blocked) piros változat:
// az új ajánlattétel addig felfüggesztve, amíg az adat meg nem érkezik.
import { useState } from 'react';
import { Receipt } from 'lucide-react';
import { api } from '@/api';
import { useToast } from '@/components/ToastProvider';

export default function TaxDataCard({ profile, onSaved }: { profile: any; onSaved: () => void }) {
  const toast = useToast();
  const [taxId, setTaxId] = useState('');
  const [birthDate, setBirthDate] = useState('');
  const [address, setAddress] = useState(profile?.billing_address || '');
  const [saving, setSaving] = useState(false);

  const state = profile?.tax_data;
  if (!state?.needed) return null;

  const blocked = Boolean(state.blocked);
  const deadline = state.deadline
    ? new Date(state.deadline).toLocaleDateString('hu-HU')
    : null;

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    try {
      await api.saveTaxData({
        personal_tax_id: taxId.replace(/\s/g, ''),
        birth_date: birthDate,
        address: address.trim(),
      });
      toast.success('Köszönjük! Az adóügyi adataid rögzítve.', blocked ? 'Az ajánlattételed újra aktív.' : undefined);
      onSaved();
    } catch (err: any) {
      toast.error(err.message || 'A mentés nem sikerült — ellenőrizd az adatokat.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div
      className="card"
      style={{
        marginTop: 16,
        border: `1px solid ${blocked ? 'var(--danger)' : 'var(--warning)'}`,
        background: blocked ? 'rgba(239,68,68,0.06)' : 'rgba(245,158,11,0.06)',
      }}
    >
      <h2 style={{ marginTop: 0, display: 'flex', alignItems: 'center', gap: 8, fontSize: 18 }}>
        <Receipt size={18} /> Adóazonosító jel szükséges
      </h2>
      <p style={{ fontSize: 14, lineHeight: 1.6, margin: '0 0 4px' }}>
        {blocked ? (
          <>A határidő lejárt, ezért az <strong>új ajánlattételed felfüggesztettük</strong> —
          az adatok megadása után azonnal folytathatod.</>
        ) : (
          <>Teljesítetted az első fuvarod — innentől jogszabályi kötelezettségünk
          (DAC7) a szállítók adóügyi adatainak rögzítése.
          {deadline && <> Határidő: <strong>{deadline}</strong>.</>}</>
        )}
      </p>
      <p className="muted" style={{ fontSize: 13, margin: '0 0 14px' }}>
        Az adatokat kizárólag a NAV felé történő éves, törvényi adatszolgáltatáshoz
        használjuk. A fuvardíjadból a platform továbbra sem von le semmit.
      </p>
      <form onSubmit={submit} style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
        <label style={{ fontSize: 13, fontWeight: 600 }}>
          Adóazonosító jel <span className="muted">(10 számjegy, az adókártyádon)</span>
          <input
            className="input"
            type="text"
            inputMode="numeric"
            autoComplete="off"
            placeholder="8xxxxxxxxx"
            maxLength={12}
            value={taxId}
            onChange={(e) => setTaxId(e.target.value)}
            required
            style={{ marginTop: 4 }}
          />
        </label>
        <label style={{ fontSize: 13, fontWeight: 600 }}>
          Születési dátum
          <input
            className="input"
            type="date"
            value={birthDate}
            onChange={(e) => setBirthDate(e.target.value)}
            required
            style={{ marginTop: 4 }}
          />
        </label>
        <label style={{ fontSize: 13, fontWeight: 600 }}>
          Lakcím
          <input
            className="input"
            type="text"
            autoComplete="street-address"
            placeholder="Irányítószám, település, utca, házszám"
            value={address}
            onChange={(e) => setAddress(e.target.value)}
            required
            style={{ marginTop: 4 }}
          />
        </label>
        <button className="btn" type="submit" disabled={saving} style={{ alignSelf: 'flex-start' }}>
          {saving ? 'Mentés…' : 'Adatok mentése'}
        </button>
      </form>
    </div>
  );
}
