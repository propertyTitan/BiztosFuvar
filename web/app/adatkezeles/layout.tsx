// Szegmens-szintű metadata: a böngészőfül / kereső / megosztás címe + leírása.
// A "| GoFuvar" utótagot a root layout title.template-je adja hozzá.
import type { Metadata } from 'next';
import type { ReactNode } from 'react';

export const metadata: Metadata = {
  title: 'Adatkezelési tájékoztató',
  description: 'Hogyan kezeli a GoFuvar a személyes adataidat — GDPR-tájékoztató.',
};

export default function SegmentLayout({ children }: { children: ReactNode }) {
  return children;
}
