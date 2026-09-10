// =====================================================================
//  DÍJSÁV-SZINKRON: a web kliens-tükre = a backend képlete (2026-09-10)
//
//  A kapcsolatfelvételi díjat a web mostantól ELŐRE mutatja (feladási
//  űrlap, ajánlat-kártya, járat-foglalás), a hiteles összeget viszont a
//  backend számolja elfogadáskor. Két külön megvalósítás = két hely, ahol
//  a sáv elcsúszhat: a feladó 500 Ft-ot látna a kártyán, és 1 000 Ft-ot
//  fizetne. Ez az őr a web TS-modulját tölti be (mint a Sentry-boríték őr),
//  és a két számítást egymáshoz méri a határ mindkét oldalán.
// =====================================================================
import { describe, it, expect } from 'vitest';

const { calculateConnectionFee, CONNECTION_FEE_TIERS } = require('../src/services/connectionFee');

describe('kapcsolatfelvételi díj: web-tükör = backend', () => {
  it('ugyanazt a díjat adja a sávhatár körül és a szélsőértékeken', async () => {
    const web = await import('../../web/src/lib/connectionFee.ts');
    const hatar = CONNECTION_FEE_TIERS[0].maxPriceHuf;
    const probak = [0, 1, 499, 500, hatar - 1, hatar, hatar + 1, 99999, 100000, 250000, 5000000];
    for (const ar of probak) {
      expect(
        web.kapcsolatfelvetelDijHuf(ar),
        `ELCSÚSZOTT A DÍJSÁV: ${ar} Ft fuvardíjnál a web ${web.kapcsolatfelvetelDijHuf(ar)} Ft-ot `
        + `mutat, a backend ${calculateConnectionFee(ar)} Ft-ot számol. A feladó mást lát a `
        + 'kártyán, mint amit fizet — igazítsd a web/src/lib/connectionFee.ts sávjait a '
        + 'backend/src/services/connectionFee.js-hez (vagy fordítva, üzleti döntéssel).',
      ).toBe(calculateConnectionFee(ar));
    }
  });

  it('a sávtáblák szerkezete azonos (darab, határok, díjak)', async () => {
    const web = await import('../../web/src/lib/connectionFee.ts');
    expect(web.DIJ_SAVOK.map((s) => [s.maxFuvardijHuf, s.dijHuf]))
      .toEqual(CONNECTION_FEE_TIERS.map((t) => [t.maxPriceHuf, t.feeHuf]));
  });
});
