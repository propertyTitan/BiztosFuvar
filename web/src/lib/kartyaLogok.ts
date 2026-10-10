// =====================================================================
//  ELFOGADOTT KÁRTYÁK ÉS A BANKI LOGÓKÉP — EGY HELYEN
//
//  2026-10-10 — A CIB BANK ÍRÁSOS KÉRÉSE (a honlap-teszt után): „A banki és
//  kártyatársasági logók nem megfelelően szerepelnek az oldalon. Kérjük a
//  Technikai dokumentáció „Logó" mappájában szereplő
//  „CIB_es_kartyalogok_85px_hrz_HU.png" vagy a
//  „CIB_es_kartyalogok_85px_vrt_HU.png" logók használatát."
//  Ezért a korábbi, márkánként külön kirakott SVG-logók (CIB, Visa, V Pay,
//  Mastercard, Maestro, Visa Secure, ID Check) KIKERÜLTEK: a lábléc, a
//  fizetési kártya és a /bankkartyas-fizetes oldal a bank EGYBEN
//  szerkesztett képét mutatja (CibKartyaLogok.tsx) — széles képernyőn a
//  vízszintes, keskenyen a függőleges változatot. A fájlok a bank nyilvános
//  marketinganyagai, a banki fájlnévvel, változatlanul, a web/public/cib/
//  alatt. (A csomag 50 px-es vízszintes változata is ott van, de a bank a
//  két 85 px-est nevezte meg, ezért a felület azokat használja.)
//
//  ELFOGADOTT KÁRTYÁK: a lista EGY konstans. A kérdések-válaszok (GYFK)
//  márka-specifikus mondatai (Visa Electron, co-branded, Visa Secure,
//  Mastercard Identity Check) a `kartyaElfogadva`-n át követik.
//  ⚠️ A banki logókép és a banki tájékoztató szövege (lib/cibTajekoztato.ts)
//  RÖGZÍTETT banki anyag: ha a szerződés szerinti lista megváltozik, a
//  banktól új képet és szöveget kell kérni — azok nem követik a listát.
//  A bank oldala és a teszt-bank mérése (2026-10-01) szerint a lista:
//  Visa, V Pay, Mastercard, Maestro — ugyanez van a képen is.
//  Banki dokumentáció vagy kulcs SOHA nem kerül a repóba.
// =====================================================================

export type KartyaId = 'visa' | 'vpay' | 'mastercard' | 'maestro';

/** A márkák megjelenített nevei (a GYFK felsorolásaihoz). */
export const KARTYA_NEVEK: Record<KartyaId, string> = {
  visa: 'Visa',
  vpay: 'V Pay',
  mastercard: 'Mastercard',
  maestro: 'Maestro',
};

/** A szerződés szerinti lista — lásd a fájl fejlécét. */
export const ELFOGADOTT_KARTYAK: readonly KartyaId[] = ['visa', 'vpay', 'mastercard', 'maestro'];

/** Egy banki képváltozat: a forrásfájl és a megjelenítési méret (CSS px). */
export type KepValtozat = {
  src: string;
  /** A banki PNG valódi mérete. */
  forrasSzel: number;
  forrasMag: number;
  /** A megjelenítés (a forrásnál soha nem nagyobb — nincs felnagyítás). */
  szel: number;
  mag: number;
};

/**
 * A CIB Bank és a kártyatársaságok egyben szerkesztett logóképe (a bank
 * kérése, 2026-10-10). A `keskenyMedia` alatt a függőleges változat jön; a
 * CibKartyaLogok.module.css ugyanezt a töréspontot használja.
 */
export const CIB_KARTYALOGOK_KEP = {
  alt: 'CIB Bank — elfogadott kártyák: Mastercard, Maestro, Visa, V Pay; Mastercard ID Check, Visa Secure',
  vizszintes: {
    src: '/cib/CIB_es_kartyalogok_85px_hrz_HU.png', forrasSzel: 971, forrasMag: 85, szel: 503, mag: 44,
  } as KepValtozat,
  fuggoleges: {
    src: '/cib/CIB_es_kartyalogok_85px_vrt_HU.png', forrasSzel: 623, forrasMag: 170, szel: 340, mag: 93,
  } as KepValtozat,
  keskenyMedia: '(max-width: 560px)',
} as const;

/**
 * Elfogadjuk-e a márkát? A GYFK márka-specifikus mondatai (Visa Electron,
 * co-branded, Visa Secure, Mastercard Identity Check) ezen múlnak, hogy a
 * lista módosításakor ne maradjon bent olyan állítás, ami már nem igaz.
 */
export function kartyaElfogadva(id: KartyaId): boolean {
  return ELFOGADOTT_KARTYAK.includes(id);
}

/** Az elfogadott márkák nevei felsorolásként („Visa, V Pay, Mastercard és Maestro"). */
export function elfogadottKartyakSzoveg(): string {
  const nevek = ELFOGADOTT_KARTYAK.map((k) => KARTYA_NEVEK[k]);
  if (nevek.length <= 1) return nevek.join('');
  return `${nevek.slice(0, -1).join(', ')} és ${nevek[nevek.length - 1]}`;
}
