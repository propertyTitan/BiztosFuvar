import type { Metadata } from 'next';
// A teljes szállító-mód (/sofor/*) közös rétege: a szállítói KRESZ-nyilatkozat
// kapuja. A DriverTermsGate akkor jelenít meg blokkoló modalt, ha a
// felhasználó még nem fogadta el a nyilatkozatot — a szállító-mód első
// használatakor kell elfogadni.
import type { ReactNode } from 'react';
import DriverTermsGate from '@/components/DriverTermsGate';

export const metadata: Metadata = {
  title: 'Szállítói felület',
  // Privát/hitelesített felület (2026-09-11, C2): ne indexelődjön.
  robots: { index: false, follow: false },
};

export default function SoforLayout({ children }: { children: ReactNode }) {
  return (
    <>
      <DriverTermsGate />
      {children}
    </>
  );
}
