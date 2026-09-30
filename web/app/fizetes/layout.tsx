// Szegmens-szintű metadata a banki visszatérés eredményoldalához (CIB PR-3).
// A "| GoFuvar" utótagot a root layout title.template-je adja hozzá.
import type { Metadata } from 'next';
import type { ReactNode } from 'react';

export const metadata: Metadata = {
  // Egyedi, aláírt tokennel nyíló, személyes állapotot mutató oldal — a
  // robots.txt Allow-ra váltása után se indexelődjön (noindex-őr: noindex.test.ts).
  robots: { index: false, follow: false },
  title: 'Fizetés eredménye',
  description: 'A kapcsolatfelvételi díj bankkártyás fizetésének eredménye.',
};

export default function SegmentLayout({ children }: { children: ReactNode }) {
  return children;
}
