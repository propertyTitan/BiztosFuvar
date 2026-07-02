// Szegmens-szintű metadata: a böngészőfül / kereső / megosztás címe + leírása.
// A "| GoFuvar" utótagot a root layout title.template-je adja hozzá.
import type { Metadata } from 'next';
import type { ReactNode } from 'react';

export const metadata: Metadata = {
  title: 'Új útvonal meghirdetése',
  description: 'Hirdesd meg az útvonalad fix árakkal — a feladók lefoglalják a szabad helyed.',
};

export default function SegmentLayout({ children }: { children: ReactNode }) {
  return children;
}
