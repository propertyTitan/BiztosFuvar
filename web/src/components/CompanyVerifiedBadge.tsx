'use client';

import { BadgeCheck } from 'lucide-react';

/**
 * "Ellenőrzött cég" jelvény — akkor jelenik meg, ha a céges fiók adószámát
 * a NAV-lekérdezés igazolta (company_verification_status === 'verified').
 * Használat: cégnév / szállító-név mellett, ajánlat-kártyán, profilon.
 */
export default function CompanyVerifiedBadge({ small = false }: { small?: boolean }) {
  return (
    <span
      className="pill"
      title="A cég adószámát a NAV nyilvántartása alapján ellenőriztük."
      style={{
        background: 'rgba(22,163,74,0.12)',
        color: 'var(--success)',
        fontWeight: 800,
        fontSize: small ? 11 : 12,
        display: 'inline-flex',
        alignItems: 'center',
        gap: 4,
        whiteSpace: 'nowrap',
      }}
    >
      <BadgeCheck size={small ? 12 : 14} />
      Ellenőrzött cég
    </span>
  );
}
