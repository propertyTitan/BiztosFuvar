'use client';

// DAC7 adóazonosító-bekérő kártya (Vinted-minta): CSAK akkor jelenik meg,
// ha a magánszemély szállító már teljesített fuvart (a backend beállította
// a bekérést — me.tax_data.needed), de még nem adta meg az adatait.
// A 60 napos határidő lejárta után (me.tax_data.blocked) piros változat:
// az új ajánlattétel addig felfüggesztve, amíg az adat meg nem érkezik.
import { useState } from 'react';
import FieldError, { redBorder } from '@/components/FieldError';
import { Receipt } from 'lucide-react';
import { api } from '@/api';
import { useToast } from '@/components/ToastProvider';

export default function TaxDataCard({ profile, onSaved }: { profile: any; onSaved: () => void }) {
  const toast = useToast();
  const [taxId, setTaxId] = useState('');
  const [birthDate, setBirthDate] = useState('');
  const [address, setAddress] = useState(profile?.billing_address || '');
  // Mezőszintű hibajelzés (2026-08-16, tesztelői kérés): eddig csak egy
  // eltűnő toast szólt — nem látszott, MELYIK mező rossz és MIT kell tenni.
  // A backend a saját ellenőrzését is lefuttatja; itt az elgépeléseket fogjuk
  // meg, hogy a hiba a mezőnél jelenjen meg, ne egy általános üzenetben.
  const [probalt, setProbalt] = useState(false);
  const tisztaTaxId = taxId.replace(/\s/g, '');
  const taxIdHiba = tisztaTaxId === ''
    ? 'Kérjük, töltsd ki: Adóazonosító jel.'
    : (!/^8\d{9}$/.test(tisztaTaxId)
      ? 'Az adóazonosító jel 8-cal kezdődő, pontosan 10 számjegyű szám — az adókártyádon találod.'
      : null);
  const szuletesHiba = (() => {
    if (!birthDate) return 'Kérjük, add meg a születési dátumod.';
    const d = new Date(birthDate);
    const kor = (Date.now() - d.getTime()) / (365.25 * 86400000);
    if (Number.isNaN(d.getTime()) || d.getFullYear() < 1900) return 'Érvénytelen dátum.';
    if (kor < 18) return 'Szállítóként 18 éves kortól használható a platform — ellenőrizd az évszámot.';
    if (kor > 120) return 'Ellenőrizd az évszámot — ez a dátum túl régi.';
    return null;
  })();
  const cimHiba = address.trim().length < 5
    ? 'Add meg a teljes lakcímed: irányítószám, település, utca, házszám.'
    : null;
  const mutat = (h: string | null) => (probalt ? h : null);
  const [saving, setSaving] = useState(false);

  const state = profile?.tax_data;
  if (!state?.needed) return null;

  const blocked = Boolean(state.blocked);
  // Születési dátum: jövőbeli dátum nyilván érvénytelen, és a platformot csak
  // 18 év felett lehet szállítóként használni (ÁSZF 3.1) — a naptár ezt a két
  // korlátot mutatja is. Alsó korlát egy józan ész szerinti 1900.
  const maxBirthDate = new Date(
    Date.UTC(new Date().getUTCFullYear() - 18, new Date().getUTCMonth(), new Date().getUTCDate()),
  ).toISOString().slice(0, 10);
  const deadline = state.deadline
    ? new Date(state.deadline).toLocaleDateString('hu-HU')
    : null;

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setProbalt(true);
    if (taxIdHiba || szuletesHiba || cimHiba) {
      toast.error('Nézd át a mezőket', 'A hibás mezők pirossal jelölve — alattuk a magyarázat.');
      return;
    }
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
            style={{ marginTop: 4, ...(mutat(taxIdHiba) ? redBorder : {}) }}
          />
          <FieldError>{mutat(taxIdHiba)}</FieldError>
        </label>
        <label style={{ fontSize: 13, fontWeight: 600 }}>
          Születési dátum
          <input
            className="input"
            type="date"
            value={birthDate}
            min="1900-01-01"
            max={maxBirthDate}
            title="Jövőbeli dátum nem adható meg. Szállítóként 18 éves kortól használható a platform."
            onChange={(e) => setBirthDate(e.target.value)}
            required
            style={{ marginTop: 4, ...(mutat(szuletesHiba) ? redBorder : {}) }}
          />
          <FieldError>{mutat(szuletesHiba)}</FieldError>
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
            style={{ marginTop: 4, ...(mutat(cimHiba) ? redBorder : {}) }}
          />
          <FieldError>{mutat(cimHiba)}</FieldError>
        </label>
        <button className="btn" type="submit" disabled={saving} style={{ alignSelf: 'flex-start' }}>
          {saving ? 'Mentés…' : 'Adatok mentése'}
        </button>
      </form>
    </div>
  );
}
