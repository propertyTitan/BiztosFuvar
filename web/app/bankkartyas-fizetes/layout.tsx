// Szegmens-szintű metadata: a CIB vásárlói tájékoztatója (CIB PR-3).
// A "| GoFuvar" utótagot a root layout title.template-je adja hozzá.
// ⚠️ PUBLIKUS, INDEXELHETŐ oldal (a bank és a vásárló is keresheti) — a
// noindex-őr (noindex.test.ts) a PUBLIKUS listán tartja.
import type { Metadata } from 'next';
import type { ReactNode } from 'react';

export const metadata: Metadata = {
  title: 'Bankkártyás fizetés',
  description:
    'A kapcsolatfelvételi díj bankkártyás fizetése a CIB Bank fizetőoldalán: elfogadott kártyák, a fizetés lépései, kérdések és válaszok.',
};

export default function SegmentLayout({ children }: { children: ReactNode }) {
  return children;
}
