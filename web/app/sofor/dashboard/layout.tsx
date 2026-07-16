// Szegmens-szintű metadata: a böngészőfül / kereső / megosztás címe + leírása.
// A "| GoFuvar" utótagot a root layout title.template-je adja hozzá.
import type { Metadata } from 'next';
import type { ReactNode } from 'react';

export const metadata: Metadata = {
  title: 'Szállító statisztikák',
  description: 'Heti kereseted, teljesített fuvarjaid és értékeléseid egy helyen.',
};

export default function SegmentLayout({ children }: { children: ReactNode }) {
  return children;
}
