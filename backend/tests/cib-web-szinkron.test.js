// =====================================================================
//  CIB-SZINKRON: a kötelező banki feliratok és az RC-csoportok webes
//  tükre = a backend forrása (2026-09-29, CIB PR-3)
//
//  A banki átvételi teszt az eredményoldalon ÉS a díj-visszaigazoló
//  e-mailben is szó szerint ugyanazt az öt feliratot keresi (TrID, RC, RT,
//  AMO, ANUM), a sikertelen fizetés magyarázata pedig az RC banki csoportjából
//  jön. Két külön megvalósítás = két hely, ahol elcsúszhat: az e-mail mást
//  írna, mint az oldal. Ez az őr a web TS-modulját tölti be (mint a díjsáv-
//  szinkron), és a kettőt egymáshoz méri.
// =====================================================================
import { describe, it, expect } from 'vitest';

const { CIB_FELIRATOK } = require('../src/data/cibFeliratok');
const rcBackend = require('../src/data/cibRcCsoportok');

describe('CIB: web-tükör = backend', () => {
  it('az öt kötelező felirat szó szerint azonos', async () => {
    const web = await import('../../web/src/lib/cibFeliratok.ts');
    for (const kulcs of ['trid', 'rc', 'rt', 'amo', 'anum']) {
      expect(web.CIB_FELIRATOK[kulcs], `ELCSÚSZOTT A(Z) ${kulcs} FELIRAT: a web és az e-mail mást ír`)
        .toBe(CIB_FELIRATOK[kulcs]);
    }
    expect(web.CIB_OSSZEG_PENZNEM).toBe(CIB_FELIRATOK.penznem);
  });

  it('minden ismert banki RC ugyanabba a csoportba esik a weben és a backendben', async () => {
    const web = await import('../../web/src/lib/cibRcCsoport.ts');
    const kodok = new Set(Object.values(web.RC_CSOPORT_KODOK).flat());
    expect(kodok.size).toBeGreaterThan(50);
    for (const kod of kodok) {
      expect(web.rcCsoportja(kod), `ELCSÚSZOTT AZ RC ${kod} CSOPORTJA`).toBe(rcBackend.rcCsoport(kod));
    }
    // siker és folyamatban: egyik oldalon sincs hibacsoport
    for (const kod of ['00', 'PR']) {
      expect(web.rcCsoportja(kod)).toBeNull();
      expect(rcBackend.rcCsoport(kod)).toBeNull();
    }
  });
});
