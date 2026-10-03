// =====================================================================
//  CIB KÁRTYÁS DÍJFIZETÉS — KÖTELEZŐ FELIRATOK (egy forrásból)
//
//  ⚠️ SZÓ SZERINT KÖTELEZŐ: a CIB „Fejlesztési javaslatok" (Tranzakció
//  eredményének visszaigazolása) szerint a vásárlót a visszaérkezése után a
//  TrID, RC, RT, AMO és ANUM értékéről tájékoztatni kell, és „a fenti értékek
//  kísérőszövege meg kell egyezzen a fenti lista elemeivel". A banki átvételi
//  teszt ezt betűre nézi — ne fogalmazd át, ne „szépítsd".
//
//  A backend-tükör (backend/src/data/cibFeliratok.js, a CIB-mag PR-je) a
//  sikeres/sikertelen fizetés e-mailjeiben ugyanezt a szöveget használja; a
//  kettőt egy szinkronőr tartja egyben (a dij-sav-web-szinkron mintájára).
//  Ezért a kulcsok (trid/rc/rt/amo/anum) és a szövegek itt a mérvadók.
//  Őr: cibFeliratok.test.ts.
// =====================================================================

export const CIB_FELIRATOK = {
  trid: 'A tranzakció azonosítója (TrID)',
  rc: 'A tranzakció eredményének kódja (RC)',
  rt: 'A tranzakció eredményének szöveges ismertetése (RT)',
  amo: 'A fizetett összeg (AMO)',
  anum: 'A kibocsátó bank által adott engedélyszám (ANUM)',
} as const;

export type CibFeliratKulcs = keyof typeof CIB_FELIRATOK;

/** A banki lista sorrendje — a megjelenítés is ezt követi. */
export const CIB_FELIRAT_SORREND: readonly CibFeliratKulcs[] = ['trid', 'rc', 'rt', 'amo', 'anum'];

/**
 * Az AMO felirata NEM sikeres kimenetnél (sikertelen, nem terhelt, már
 * fizetett, ellenőrzés alatt). 2026-10-03 (CIB PR-5, a valódi banknál
 * talált hiba): a „fizetett összeg" egy el nem fogadott vagy le nem zárt
 * fizetésnél hamis. Az AMO-kód és az érték marad (a bank kötelező adata);
 * sikeres fizetésnél a banki felirat (CIB_FELIRATOK.amo) szó szerint áll.
 */
export const CIB_AMO_NEM_FIZETETT_FELIRAT = 'A tranzakció összege (AMO)';

/** Az AMO felirata a kimenet szerint: csak sikeres fizetésnél „fizetett". */
export function amoFelirat(fizetett: boolean): string {
  return fizetett ? CIB_FELIRATOK.amo : CIB_AMO_NEM_FIZETETT_FELIRAT;
}

/** Az AMO mellé kiírt pénznem (a díj mindig forintban megy). */
export const CIB_OSSZEG_PENZNEM = 'HUF';

/** Hiányzó banki érték jele (pl. elutasításnál nincs engedélyszám). */
export const CIB_URES_ERTEK = '–';

// ── A fizetési folyamat kötelező mondatai (banki tesztelési szempontok) ──

/** „A kereskedő telephelyének/székhelyének országneve kötelezően
 *  szerepeltetendő a fizetési folyamat legalább egyik oldalán." */
export const KERESKEDO_ORSZAG_SOR =
  'A Kereskedő/Tiszta Hód Kft. székhelyének országa és országkódja: Magyarország (HU)';

export const KARTYAADAT_SOR =
  'A kártyaadataidat kizárólag a CIB Bank oldalán adod meg, a GoFuvar nem látja őket.';

/** A CIB-logó kötelező kísérőszövege. */
export const CIB_SZOLGALTATO_FELIRAT = 'Kártyás fizetés szolgáltatója:';

/** A kártyalogók kötelező kísérőszövege. */
export const ELFOGADOTT_KARTYAK_FELIRAT = 'Elfogadott kártyák';

/** A banki tájékoztató linkjének szövege (a bank által felsorolt egyik változat). */
export const BANKKARTYAS_FIZETES_LINK = 'Bankkártyás fizetés';

/** Az adatkezelési tájékoztató linkjének kötelező szövege. */
export const ADATKEZELESI_LINK = 'Adatkezelési tájékoztató';

/**
 * A CIB felé történő adattovábbítási nyilatkozat (2026-10-01, a bank írásos
 * válasza: a hozzájárulás akkor is KÖTELEZŐ, ha vásárlói adatot nem
 * küldünk). A fizetési kártyán egy KÜLÖN, előre ki nem pipált jelölőnégyzet
 * szövege — a 45/2014-es nyilatkozat mellett, nem helyette; a fizetés gombja
 * csak mindkettővel nyomható. SZÓ SZERINT a bank által kért mondat: ne
 * fogalmazd át. Az „Adatkezelési tájékoztató" rész link a tájékoztató CIB-
 * szakaszára (CIB_ADATKEZELESI_LINK). A backend-tükör
 * (backend/src/data/cibFeliratok.js) ugyanez — a cib-web-szinkron őr veti
 * össze.
 */
export const CIB_ADATKEZELESI_NYILATKOZAT =
  'Kijelentem, hogy az adatkezeléshez kapcsolódó tájékoztatást megértettem és tudomásul vettem. '
  + 'Ezennel önkéntesen és megfelelő tájékoztatás birtokában hozzájárulok ahhoz, hogy a Tiszta Hód Kft. '
  + 'az önkéntesen megadott személyes adataimat az Adatkezelési tájékoztatóban meghatározott célból '
  + 'továbbítsa a CIB Bank Zrt. részére.';

/** A nyilatkozatban linkelt rész és a célja (a tájékoztató CIB-szakasza). */
export const CIB_ADATKEZELESI_LINK = {
  szoveg: 'Adatkezelési tájékoztató',
  href: '/adatkezeles#cib-kartyas-fizetes',
} as const;

/** A bank 10 perc után reverzál; a mobilos alkalmazásváltás a leggyakoribb
 *  megszakító — ezt előre elmondjuk (failure mode 10). 2026-10-01 (a PR-4 1.
 *  javítóköre): a helyi lezárási ablak a MSGT10-től 9 perc 30 mp
 *  (CIB_ZARAS_HATARIDO_MP), és a lezárás (egy lekérdezés + a MSGT32) is ebbe
 *  esik — a „kb. 10 perc" túlígéret volt. 2026-10-03 (CIB PR-5, lelet 27): a
 *  visszatérés után még egy banki lekérdezés és a lezárás is a 9:30-ba fér,
 *  ezért a vásárlónak kb. 8 percet mondunk (a „kb. 9 perc" is túlígéret). */
export const CIB_IDO_TIPP =
  'A fizetést a bank oldalán kb. 8 percen belül fejezd be; ne frissítsd és ne lépj vissza. Ha a bankod alkalmazásában hagyod jóvá, utána térj vissza ebbe a böngészőbe.';

/** A CIB banki tesztkörnyezet sávjának szövege (TesztFizetesSav, 'cib_teszt'). */
export const CIB_TESZT_SAV_SZOVEG =
  'CIB BANKI TESZTKÖRNYEZET – valódi terhelés nincs, csak a bank tesztkártyái működnek';

/** Egy banki érték megjelenítése: üres/hiányzó → „–". */
export function bankiErtek(v: string | number | null | undefined): string {
  if (v === null || v === undefined) return CIB_URES_ERTEK;
  const s = String(v).trim();
  return s ? s : CIB_URES_ERTEK;
}

/** Az AMO kiírása a pénznemmel („500 HUF"); hiányzó értékre „–". */
export function osszegKiiras(amo: string | number | null | undefined): string {
  const s = bankiErtek(amo);
  return s === CIB_URES_ERTEK ? s : `${s} ${CIB_OSSZEG_PENZNEM}`;
}
