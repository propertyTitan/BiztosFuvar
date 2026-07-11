// Szegmens-szintű metadata: a böngészőfül / kereső / megosztás címe + leírása.
// A "| GoFuvar" utótagot a root layout title.template-je adja hozzá.
import type { Metadata } from 'next';
import type { ReactNode } from 'react';

export const metadata: Metadata = {
  title: 'Új fuvar feladása',
  description: 'Add fel a fuvarod pár perc alatt: cím, méret, ár — a sofőrök ajánlatot tesznek rá, te választasz.',
};

export default function SegmentLayout({ children }: { children: ReactNode }) {
  return children;
}
