// Szegmens-szintű metadata: a böngészőfül / kereső / megosztás címe + leírása.
// A "| GoFuvar" utótagot a root layout title.template-je adja hozzá.
import type { Metadata } from 'next';
import type { ReactNode } from 'react';

export const metadata: Metadata = {
  title: 'Jelszó visszaállítása',
  description: 'Új jelszó igénylése emailben.',
};

export default function SegmentLayout({ children }: { children: ReactNode }) {
  return children;
}
