// Szegmens-szintű metadata: a böngészőfül / kereső / megosztás címe + leírása.
// A "| GoFuvar" utótagot a root layout title.template-je adja hozzá.
import type { Metadata } from 'next';
import type { ReactNode } from 'react';

export const metadata: Metadata = {
  // Privát/hitelesített felület (2026-09-11, C2): a robots.txt Allow-ra váltása után se indexelődjön.
  robots: { index: false, follow: false },
  title: 'Fizetés',
  description: 'A kapcsolatfelvételi díj biztonságos fizetése.',
};

export default function SegmentLayout({ children }: { children: ReactNode }) {
  return children;
}
