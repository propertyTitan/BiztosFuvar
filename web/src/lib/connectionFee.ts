// Kapcsolatfelvételi díj — a backend `services/connectionFee.js` KLIENS-TÜKRE.
//
// MIÉRT VAN A WEBEN IS (2026-09-10, fogalmazás-audit + user-döntés): a feladó
// a leghosszabb űrlapon úgy ment végig, hogy egy szó sem esett a díjról, és az
// ajánlatok közül úgy választott, hogy nem tudta: a 45 000 Ft-os és az
// 55 000 Ft-os ajánlat elfogadása KÉTSZERES díjat jelent. A sáv pont a
// választásnál számít, ezért a díjat az űrlapon, minden ajánlat-kártyán és a
// járat-foglalásnál ELŐRE megmutatjuk. A hiteles összeget elfogadás után
// továbbra is a backend adja (`connection_fee_huf`) — ez csak előrejelzés.
//
// ⚠️ A SÁVOK A BACKENDDEL SZINKRONBAN TARTANDÓK: a backend
// `dij-sav-web-szinkron.test.js` betölti ezt a modult és a két számítást
// egymáshoz méri — ha az egyik oldal változik, a másik nélkül piros.
// Üzleti döntés: CLAUDE.md 5. szakasz (2026-07-15: ≤50 000 Ft → 500 Ft,
// felette 1 000 Ft, bruttó, bevezető ár, nem visszatérítendő).

export const DIJ_SAVOK: ReadonlyArray<{ maxFuvardijHuf: number; dijHuf: number }> = [
  { maxFuvardijHuf: 50000, dijHuf: 500 },
  { maxFuvardijHuf: Infinity, dijHuf: 1000 },
];

/** A sávhatár: eddig a fuvardíjig jár az alsó díj (befoglaló). */
export const DIJ_SAVHATAR_HUF = DIJ_SAVOK[0].maxFuvardijHuf;

/** A fuvardíjhoz tartozó kapcsolatfelvételi díj (bruttó Ft) — a backend képlete. */
export function kapcsolatfelvetelDijHuf(fuvardijHuf: number | null | undefined): number {
  const ar = Number(fuvardijHuf) || 0;
  const sav = DIJ_SAVOK.find((s) => ar <= s.maxFuvardijHuf) ?? DIJ_SAVOK[DIJ_SAVOK.length - 1];
  return sav.dijHuf;
}

/** Magyar ezres-tagolás (pl. 50 000). */
export function ft(n: number): string {
  return n.toLocaleString('hu-HU');
}

/** Az egyetlen, mindenhol azonos szabály-mondat (a számok a sávokból jönnek). */
export const DIJ_SZABALY_SZOVEG = `${ft(DIJ_SAVOK[0].dijHuf)} Ft ${ft(DIJ_SAVHATAR_HUF)} Ft fuvardíjig, felette ${ft(DIJ_SAVOK[1].dijHuf)} Ft — bevezető ár, nem visszatérítendő`;
