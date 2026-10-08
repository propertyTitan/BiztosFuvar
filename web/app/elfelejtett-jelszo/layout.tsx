// Szegmens-szintű metadata: a böngészőfül / kereső / megosztás címe + leírása.
// A "| GoFuvar" utótagot a root layout title.template-je adja hozzá.
// UX-kör A25 (2026-10-08): eddig a főoldal címét örökölte — a lapváltóban és
// a képernyőolvasóban nem lehetett megkülönböztetni.
import type { Metadata } from 'next';
import type { ReactNode } from 'react';

export const metadata: Metadata = {
  title: 'Elfelejtett jelszó',
  description: 'Jelszó-visszaállító link kérése a GoFuvar-fiókodhoz.',
};

export default function SegmentLayout({ children }: { children: ReactNode }) {
  return children;
}
