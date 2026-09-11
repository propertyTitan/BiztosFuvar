'use client';

// A járat-ág oldalainak „Hamarosan" képernyője, amíg a funkció rejtett
// (lib/features.ts, JARAT_ENGEDELYEZVE). Közvetlen linken érkezőnek is
// őszinte üzenet: nincs félig működő felület.
import Link from 'next/link';
import { Route } from 'lucide-react';
import { EmptyState } from '@/components/StateView';

export default function JaratHamarosan() {
  return (
    <div style={{ maxWidth: 720, margin: '0 auto', padding: '32px 16px' }}>
      <EmptyState
        icon={<Route size={28} />}
        title="Az induló járatok hamarosan érkeznek"
        description="Ez a funkció még nem elérhető: itt a szállítók fix áron hirdetik majd az induló járatukat, a feladók pedig helyet foglalhatnak rajta. Addig add fel a fuvart, és a szállítók ajánlatot tesznek rá."
        cta={<Link href="/dashboard/uj-fuvar" className="btn">Fuvar feladása</Link>}
      />
    </div>
  );
}
