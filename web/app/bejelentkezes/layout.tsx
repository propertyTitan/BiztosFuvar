// Szegmens-szintű metadata: a böngészőfül / kereső / megosztás címe + leírása.
// A "| GoFuvar" utótagot a root layout title.template-je adja hozzá.
import type { Metadata } from 'next';
import type { ReactNode } from 'react';

export const metadata: Metadata = {
  title: 'Bejelentkezés és regisztráció',
  description: 'Lépj be a GoFuvar fiókodba, vagy regisztrálj ingyen — feladóként és sofőrként is használhatod.',
};

export default function SegmentLayout({ children }: { children: ReactNode }) {
  return children;
}
