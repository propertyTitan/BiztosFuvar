// A teljes sofőr-mód (/sofor/*) közös rétege: a sofőri KRESZ-nyilatkozat
// kapuja. A DriverTermsGate akkor jelenít meg blokkoló modalt, ha a
// felhasználó még nem fogadta el a nyilatkozatot — a sofőr-mód első
// használatakor kell elfogadni.
import type { ReactNode } from 'react';
import DriverTermsGate from '@/components/DriverTermsGate';

export default function SoforLayout({ children }: { children: ReactNode }) {
  return (
    <>
      <DriverTermsGate />
      {children}
    </>
  );
}
