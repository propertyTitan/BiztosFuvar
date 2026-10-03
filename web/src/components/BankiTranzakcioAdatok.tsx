// =====================================================================
//  BankiTranzakcioAdatok — a bank által kötelezővé tett adatsor
//
//  CIB „Fejlesztési javaslatok" — Tranzakció eredményének visszaigazolása:
//  a vásárlót a visszaérkezése után tájékoztatni kell a TrID, RC, RT, AMO és
//  ANUM értékéről, és „a fenti értékek kísérőszövege meg kell egyezzen a
//  fenti lista elemeivel". A feliratok ezért EGY forrásból jönnek
//  (lib/cibFeliratok.ts), szó szerint. Hiányzó érték (pl. elutasításnál nincs
//  engedélyszám): „–" — a sor ettől még látszik.
// =====================================================================
import type { CibBankiAdatok } from '@/api';
import {
  CIB_FELIRAT_SORREND, CIB_FELIRATOK, amoMegjegyzes, bankiErtek, osszegKiiras, type AmoKimenet,
} from '@/lib/cibFeliratok';

type Props = {
  adatok: CibBankiAdatok;
  /** A „mentsd el" tipp (az eredményoldalon kötelezően ajánlott). */
  mentesTipp?: boolean;
  /**
   * A kísérlet kimenete. A FELIRATOK ettől függetlenül szó szerint a bankiak
   * (az AMO-é sikertelen fizetésnél is „A fizetett összeg (AMO)" — 2026-10-03,
   * a PR-5 web 1. javítóköre); nem sikeres kimenetnél egy KÜLÖN mondat mondja
   * el, mi történt a kártyával. Megadása nélkül nincs ilyen mondat (admin).
   */
  kimenet?: AmoKimenet;
};

export default function BankiTranzakcioAdatok({ adatok, mentesTipp = false, kimenet }: Props) {
  const ertek = (k: (typeof CIB_FELIRAT_SORREND)[number]): string => {
    if (k === 'amo') return osszegKiiras(adatok.amo);
    return bankiErtek(adatok[k] as string | null | undefined);
  };
  const megjegyzes = kimenet ? amoMegjegyzes(kimenet) : null;
  return (
    <div data-testid="banki-tranzakcio-adatok">
      <dl
        style={{
          display: 'grid',
          gridTemplateColumns: 'minmax(0, 1fr)',
          gap: 8,
          margin: 0,
          fontSize: 13,
        }}
      >
        {CIB_FELIRAT_SORREND.map((k) => (
          <div
            key={k}
            style={{
              display: 'flex', flexWrap: 'wrap', justifyContent: 'space-between', gap: '2px 12px',
              paddingBottom: 6, borderBottom: '1px solid var(--border)',
            }}
          >
            <dt className="muted" style={{ margin: 0, flex: '1 1 220px', minWidth: 0 }}>{CIB_FELIRATOK[k]}</dt>
            <dd
              style={{
                margin: 0, fontWeight: 700, flex: '0 1 auto', minWidth: 0,
                overflowWrap: 'anywhere', fontVariantNumeric: 'tabular-nums',
              }}
            >
              {ertek(k)}
            </dd>
          </div>
        ))}
      </dl>
      {megjegyzes && (
        <p data-testid="amo-megjegyzes" style={{ fontSize: 13, margin: '8px 0 0' }}>{megjegyzes}</p>
      )}
      {mentesTipp && (
        <p className="muted" style={{ fontSize: 12, margin: '8px 0 0' }}>
          Érdemes elmentened ezeket az adatokat (képernyőkép vagy jegyzet) — a bankod
          ezek alapján tud segíteni, ha kérdésed van a tranzakcióval kapcsolatban.
        </p>
      )}
    </div>
  );
}
