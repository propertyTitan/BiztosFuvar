'use client';

import { useEffect, useState } from 'react';
import { api } from '@/api';

type ReferralInfo = {
  code: string | null;
  link: string | null;
  totalReferred: number;
  completedReferred: number;
  availableVouchers: number;
};

export default function ReferralCard() {
  const [info, setInfo] = useState<ReferralInfo | null>(null);
  const [copied, setCopied] = useState<'code' | 'link' | null>(null);

  useEffect(() => {
    api.getReferralInfo().then(setInfo).catch(() => {});
  }, []);

  if (!info || !info.link || !info.code) return null;

  async function copy(what: 'code' | 'link', value: string) {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(what);
      setTimeout(() => setCopied(null), 2000);
    } catch {
      // Ha a clipboard nem elérhető, a user kézzel is kimásolhatja a mezőből.
    }
  }

  return (
    <div className="card" style={{ marginTop: 16 }}>
      <h2 style={{ marginTop: 0 }}>🎁 Hívd meg ismerőseidet</h2>
      <p className="muted" style={{ marginTop: 0 }}>
        Oszd meg a kódodat vagy a linkedet. Ha valaki vele regisztrál és
        teljesíti az első fuvarját (feladóként vagy szállítóként), a következő
        feladásod kapcsolatfelvételi díját <strong>elengedjük</strong>.
      </p>

      {/* Ajánlói kód — verbális/üzenetben megosztható, kézzel is beírható a
          regisztrációnál. */}
      <label style={{ fontSize: 13, fontWeight: 600 }}>Ajánlói kódod</label>
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center', margin: '4px 0 12px' }}>
        <input
          className="input"
          readOnly
          value={info.code}
          onFocus={(e) => e.currentTarget.select()}
          style={{ flex: '0 0 auto', width: 140, fontSize: 20, fontWeight: 800, letterSpacing: 2, textAlign: 'center' }}
        />
        <button type="button" className="btn" onClick={() => copy('code', info.code!)} style={{ whiteSpace: 'nowrap' }}>
          {copied === 'code' ? '✓ Kimásolva' : 'Kód másolása'}
        </button>
      </div>

      <label style={{ fontSize: 13, fontWeight: 600 }}>Vagy oszd meg a linkedet</label>
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center', margin: '4px 0 12px' }}>
        <input
          className="input"
          readOnly
          value={info.link}
          onFocus={(e) => e.currentTarget.select()}
          style={{ flex: 1, minWidth: 220, fontSize: 13 }}
        />
        <button type="button" className="btn" onClick={() => copy('link', info.link!)} style={{ whiteSpace: 'nowrap' }}>
          {copied === 'link' ? '✓ Kimásolva' : 'Link másolása'}
        </button>
      </div>

      <div style={{ display: 'flex', gap: 20, flexWrap: 'wrap', fontSize: 14 }}>
        <span>Meghívottak: <strong>{info.totalReferred}</strong></span>
        <span>Teljesített: <strong>{info.completedReferred}</strong></span>
        <span>Ingyen feladás kupon: <strong>{info.availableVouchers}</strong></span>
      </div>
    </div>
  );
}
