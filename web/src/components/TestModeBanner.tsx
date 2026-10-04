'use client';

// =====================================================================
//  Globális teszt-üzem sáv (az egész appra, a layoutban).
//
//  2026-10-03 (CIB PR-5, C1): a sáv eddig FELTÉTEL NÉLKÜL azt írta minden
//  oldalon, hogy „valódi pénzmozgás nincs, a fizetés csak szimuláció" — a
//  launch után is ott maradt volna, miközben a kártyás díjat valódi pénzzel
//  fizetik. Mostantól a GET /config/public dönt (lib/publikusKonfig.ts):
//   - stub teszt-fizetés → „szimuláció";
//   - CIB tesztkörnyezet → a bank tesztkörnyezete, valódi terhelés nincs;
//   - teszt-üzem ÉLES kártyás fizetés mellett → figyelmeztet, de a pénzről
//     semmit nem állít;
//   - hiba / ismeretlen válasz / éles üzem → NINCS sáv (fail-closed).
//
//  A háttér szándékosan var(--warning-light) (a globals.css ismert
//  pasztell-listájában szerepel), az .on-light osztállyal együtt így a
//  szöveg dark mode-ban is sötét és olvasható marad.
//
//  2026-10-04 (a PR-5 web 2. javítóköre): a /fizetes/eredmeny oldalon a
//  CIB-teszt sávot nem ismételjük — az oldal saját, a banki adatsor mellé
//  tett CIB-teszt jelzése (CibTesztJelzes) ugyanezt mondja.
// =====================================================================
import { useEffect, useState } from 'react';
import { usePathname } from 'next/navigation';
import { Construction } from 'lucide-react';
import { publikusKonfig, tesztUzemSav, type TesztUzemSav } from '@/lib/publikusKonfig';

const SAJAT_CIB_TESZT_JELZESU_OLDALAK = ['/fizetes/eredmeny'];

export default function TestModeBanner() {
  const [sav, setSav] = useState<TesztUzemSav | null>(null);
  const pathname = usePathname();

  useEffect(() => {
    let el = true;
    publikusKonfig().then((k) => { if (el) setSav(tesztUzemSav(k)); });
    return () => { el = false; };
  }, []);

  if (!sav) return null;
  // 2026-10-03: az eredményoldal mindig egy valódi CIB-kísérletről szól (a
  // stub-fizetésnek nincs eredményoldala) — a „csak szimuláció" sáv ott hamis
  // volna, pl. a teszt-allowlist lezárása után egy korábbi banki kísérleten.
  if ((sav.fajta === 'cib_teszt' || sav.fajta === 'stub')
    && pathname && SAJAT_CIB_TESZT_JELZESU_OLDALAK.includes(pathname)) return null;

  return (
    <div
      role="status"
      className="on-light"
      data-testid="teszt-uzem-sav"
      data-fajta={sav.fajta}
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 10,
        margin: '16px 0',
        padding: '12px 16px',
        background: 'var(--warning-light)',
        border: '1px solid #f0c200',
        borderRadius: 12,
        fontSize: 14,
        lineHeight: 1.4,
      }}
    >
      <Construction size={20} style={{ flexShrink: 0 }} aria-hidden />
      <span>
        <strong>{sav.cim}</strong> {sav.szoveg}
      </span>
    </div>
  );
}
