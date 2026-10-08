// A publikus profil címe (UX-kör A25, 2026-10-08): eddig a szülő /profil
// layout „Profilom" címét örökölte — más ember profilján is „Profilom" állt a
// böngészőfülön. A robots: noindex a szülőtől öröklődik.
// ⚠️ A névvel bővített cím („Szabó Péter profilja") az oldal adatából jönne —
// a profil-végpont hitelesített, ezért szerver-oldali generateMetadata nem
// éri el; azt az oldal kliens-kódja állíthatja be.
import type { Metadata } from 'next';
import type { ReactNode } from 'react';

export const metadata: Metadata = {
  title: 'Felhasználói profil',
  description: 'Egy GoFuvar-felhasználó értékelései és teljesített fuvarjai.',
};

export default function SegmentLayout({ children }: { children: ReactNode }) {
  return children;
}
