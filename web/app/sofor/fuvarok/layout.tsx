// Szegmens-szintű metadata: a böngészőfül / kereső / megosztás címe + leírása.
// A "| GoFuvar" utótagot a root layout title.template-je adja hozzá.
import type { Metadata } from 'next';
import type { ReactNode } from 'react';

export const metadata: Metadata = {
  title: 'Licitálható fuvarok',
  description: 'Nyitott fuvarok sofőröknek: licitálj arra, ami útba esik, és keress a szabad kapacitásoddal.',
};

export default function SegmentLayout({ children }: { children: ReactNode }) {
  return children;
}
