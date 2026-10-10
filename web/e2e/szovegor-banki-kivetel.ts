// =====================================================================
//  SZÖVEGŐR — A BANK ÁLTAL SZÓ SZERINT ELŐÍRT MONDATOK (kivétel)
//
//  2026-10-10: a CIB Bank a honlap-teszt után írásban kérte, hogy a
//  /bankkartyas-fizetes oldalon a vásárlói tájékoztatója („eCom_CIB.fiz.
//  taj_HU.docx") SZÓ SZERINT álljon (web/src/lib/cibTajekoztato.ts). Abban
//  van egy mondat, amit a szövegőr „biztonságos fizetés" tiltása (GF-024)
//  megfogna — ez a bank saját szövege a saját fizetőoldaláról, nem a mi
//  marketing-ígéretünk.
//
//  A kivétel SZŰK: oldalanként PONTOSAN a felsorolt banki mondatokat vesszük
//  ki a vizsgált szövegből, minden más szabály és minden más előfordulás
//  ugyanúgy bukik. Egy új oldal vagy egy átírt mondat nem élvez kivételt.
//  Az egyezést a web/src/components/cib-banki-eszrevetelek.test.tsx utolsó describe-blokkja méri: a mondat betűre a banki
//  szövegben van, és nélküle a tiltás valóban jelezne az oldalon.
//
//  ⚠️ Tiszta adatfájl (Playwright-import nélkül): a vitest-őr is betölti.
// =====================================================================

export const BANKI_ELOIRT_MONDATOK: Readonly<Record<string, readonly string[]>> = {
  '/bankkartyas-fizetes': [
    'Ezt követően Ön átkerül a CIB Bank biztonságos fizetést garantáló oldalára, ahol a fizetés megkezdéséhez kártyaadatait szükséges kitöltenie.',
  ],
};

/** A vizsgált (szóköz-normalizált) oldalszövegből kiveszi az oldal banki
 *  mondatait — PONTOS egyezéssel, máshol semmit nem változtat. */
export function bankiMondatokNelkul(oldal: string, szoveg: string): string {
  let maradek = szoveg;
  for (const mondat of BANKI_ELOIRT_MONDATOK[oldal] ?? []) maradek = maradek.split(mondat).join(' ');
  return maradek;
}
