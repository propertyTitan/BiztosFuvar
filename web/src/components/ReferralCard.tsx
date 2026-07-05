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
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    api.getReferralInfo().then(setInfo).catch(() => {});
  }, []);

  if (!info || !info.link) return null;

  async function copy() {
    if (!info?.link) return;
    try {
      await navigator.clipboard.writeText(info.link);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Ha a clipboard nem elérhető, a user kézzel is kimásolhatja a mezőből.
    }
  }

  return (
    <div className="card" style={{ marginTop: 16 }}>
      <h2 style={{ marginTop: 0 }}>🎁 Hívd meg ismerőseidet</h2>
      <p className="muted" style={{ marginTop: 0 }}>
        Oszd meg a linkedet. Ha valaki a linkeddel regisztrál és teljesíti az
        első fuvarját (feladóként vagy sofőrként), a következő feladásod
        kapcsolatfelvételi díját <strong>elengedjük</strong>.
      </p>

      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center', margin: '12px 0' }}>
        <input
          className="input"
          readOnly
          value={info.link}
          onFocus={(e) => e.currentTarget.select()}
          style={{ flex: 1, minWidth: 220, fontSize: 13 }}
        />
        <button type="button" className="btn" onClick={copy} style={{ whiteSpace: 'nowrap' }}>
          {copied ? '✓ Kimásolva' : 'Link másolása'}
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
