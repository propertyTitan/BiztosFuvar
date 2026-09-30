// =====================================================================
//  ELFOGADOTT KÁRTYÁK — EGYETLEN KONSTANS
//
//  A bank csak a SZERZŐDÉS szerint elfogadott kártyamárkák logóit engedi
//  kitenni („Elfogadott kártyák"). A lábléc, a fizetési kártya és a
//  /bankkartyas-fizetes oldal MIND ebből a listából rajzol — egy márka
//  hozzáadása/elvétele EGY sor módosítása.
//
//  ⚠️ TULAJDONOSI MEGERŐSÍTÉSRE VÁR (2026-09-29): az alapérték a CIB
//  logócsomagjának négy márkája. Ha a szerződés mást mond (pl. nincs V Pay
//  vagy Maestro), csak az ELFOGADOTT_KARTYAK sorát kell átírni — a
//  tájékoztató márka-specifikus mondatai (Visa Electron, co-branded, Visa
//  Secure, Mastercard Identity Check) a `kartyaElfogadva`-n át követik.
//  ⚠️ A lábléc GLOBÁLIS: a merge után minden oldalon ez a lista látszik.
//
//  A logók a bank nyilvános marketinganyagai (SAKI 1.50 „Logó/SVG"), a
//  web/public/cib/ alatt. Banki dokumentáció vagy kulcs SOHA nem kerül a
//  repóba.
// =====================================================================

export type KartyaId = 'visa' | 'vpay' | 'mastercard' | 'maestro';

export type LogoAdat = { nev: string; src: string; szel: number; mag: number };

/** A logók megjelenítési méretei 26 px magasságra, az SVG viewBox arányával. */
export const KARTYA_LOGOK: Record<KartyaId, LogoAdat> = {
  visa: { nev: 'Visa', src: '/cib/visa.svg', szel: 61, mag: 26 },
  vpay: { nev: 'V Pay', src: '/cib/vpay.svg', szel: 24, mag: 26 },
  mastercard: { nev: 'Mastercard', src: '/cib/mastercard.svg', szel: 37, mag: 26 },
  maestro: { nev: 'Maestro', src: '/cib/maestro.svg', szel: 33, mag: 26 },
};

/** ⚠️ A szerződés szerinti lista — lásd a fájl fejlécét (tulajdonosi megerősítés). */
export const ELFOGADOTT_KARTYAK: readonly KartyaId[] = ['visa', 'vpay', 'mastercard', 'maestro'];

/** A CIB Bank logója (viewBox 972.28 × 353.89). */
export const CIB_LOGO: LogoAdat = { nev: 'CIB Bank', src: '/cib/cib-bank.svg', szel: 77, mag: 28 };

/** A kártyatársaságok 3D Secure programjainak logói (csak a tájékoztató oldalon). */
export const HAROMDS_LOGOK: LogoAdat[] = [
  { nev: 'Visa Secure', src: '/cib/visa-secure.svg', szel: 26, mag: 26 },
  { nev: 'Mastercard Identity Check', src: '/cib/mc-idcheck.svg', szel: 38, mag: 26 },
];

/**
 * Elfogadjuk-e a márkát? A tájékoztató márka-specifikus mondatai (Visa
 * Electron, co-branded, Visa Secure, Mastercard Identity Check) ezen múlnak,
 * hogy a lista módosításakor ne maradjon bent olyan állítás, ami már nem igaz.
 */
export function kartyaElfogadva(id: KartyaId): boolean {
  return ELFOGADOTT_KARTYAK.includes(id);
}

/** Az elfogadott márkák nevei felsorolásként („Visa, V Pay, Mastercard és Maestro"). */
export function elfogadottKartyakSzoveg(): string {
  const nevek = ELFOGADOTT_KARTYAK.map((k) => KARTYA_LOGOK[k].nev);
  if (nevek.length <= 1) return nevek.join('');
  return `${nevek.slice(0, -1).join(', ')} és ${nevek[nevek.length - 1]}`;
}
