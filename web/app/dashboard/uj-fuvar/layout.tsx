// Szegmens-szintű metadata: a böngészőfül / kereső / megosztás címe.
// A "| GoFuvar" utótagot a root layout title.template-je adja hozzá.
import type { Metadata } from 'next';
import type { ReactNode } from 'react';

export const metadata: Metadata = { title: 'Új fuvar feladása' };

export default function SegmentLayout({ children }: { children: ReactNode }) {
  return children;
}
