// Szegmens-szintű metadata: a böngészőfül / kereső / megosztás címe + leírása.
// A "| GoFuvar" utótagot a root layout title.template-je adja hozzá.
import type { Metadata } from 'next';
import type { ReactNode } from 'react';

export const metadata: Metadata = {
  title: 'Új járat meghirdetése',
  description: 'Hirdesd meg a járatod fix árakkal — a feladók lefoglalják a szabad helyed.',
};

export default function SegmentLayout({ children }: { children: ReactNode }) {
  return children;
}
