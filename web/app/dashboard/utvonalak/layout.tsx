// Szegmens-szintű metadata: a böngészőfül / kereső / megosztás címe + leírása.
// A "| GoFuvar" utótagot a root layout title.template-je adja hozzá.
import type { Metadata } from 'next';
import type { ReactNode } from 'react';

export const metadata: Metadata = {
  title: 'Induló járatok',
  description: 'Böngéssz a szállítók meghirdetett útvonalai közt, és foglalj helyet a csomagodnak fix áron.',
};

export default function SegmentLayout({ children }: { children: ReactNode }) {
  return children;
}
