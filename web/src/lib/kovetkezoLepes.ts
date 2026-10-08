// =====================================================================
//  A szállító KÖVETKEZŐ LÉPÉSE egy vállalt fuvaron — EGY forrás.
//
//  2026-09-11 (teljes audit B2) óta a Fuvarjaim „Vállalt fuvarok” fül
//  megmondta, mi a teendő. A főoldal (HomeHub) „Aktív fuvarjaid” kártyája
//  viszont a saját, státusz-alapú logikáját használta: minden elfogadott
//  fuvaron zöld „INDÍTÁS →” gombot mutatott — a még KI NEM FIZETETT fuvaron
//  is, ahol a csomag a díj előtt nem vehető át (a backend a felvételi fotót
//  el is utasítja). Ugyanaz a fuvar a két felületen két különböző teendőt
//  mutatott (UX-review A5, 2026-10-08).
//
//  Mostantól mindkét felület ezt a függvényt hívja: a díjfizetésre váró
//  fuvaron NINCS cselekvésre hívó gomb, csak állapot-jelvény.
// =====================================================================

export type KovetkezoLepesFuvar = {
  status: string;
  paid_at?: string | null;
};

export type LepesKod = 'kezbesites' | 'vita' | 'felvetel' | 'dijfizetes' | 'nincs';

export type KovetkezoLepes = {
  kod: LepesKod;
  /** Hosszú leírás a munkalistához („Következő: …”). Üres, ha nincs teendő. */
  szoveg: string;
  /** Rövid gomb-felirat a főoldali kártyára — null, ha a szállítónak most nincs mit tennie. */
  gomb: string | null;
  /** Állapot-jelvény gomb helyett (pl. díjfizetésre vár) — null, ha nincs. */
  jelveny: string | null;
  /** A szállítónak most kell-e cselekednie (kiemelt megjelenés). */
  sulyos: boolean;
  /** Munkalista-sorrend: a sürgős elöl. */
  sorrend: number;
};

export function kovetkezoLepes(j: KovetkezoLepesFuvar): KovetkezoLepes {
  if (j.status === 'in_progress') {
    return {
      kod: 'kezbesites',
      szoveg: 'Kézbesítés: fotó + a címzett 6 jegyű átvételi kódja',
      gomb: 'Kézbesítés →',
      jelveny: null,
      sulyos: true,
      sorrend: 0,
    };
  }
  if (j.status === 'disputed') {
    return {
      kod: 'vita',
      szoveg: 'Vita alatt — az ügyfélszolgálat dönt, addig várj',
      gomb: null,
      jelveny: 'Vita alatt',
      sulyos: false,
      sorrend: 1,
    };
  }
  if (j.status === 'accepted' && j.paid_at) {
    return {
      kod: 'felvetel',
      szoveg: 'Felvétel: egyeztess a feladóval, majd fotó a csomagról a felvételkor',
      gomb: 'Felvétel →',
      jelveny: null,
      sulyos: true,
      sorrend: 2,
    };
  }
  if (j.status === 'accepted') {
    return {
      kod: 'dijfizetes',
      szoveg: 'A feladó díjfizetésére várunk — utána látod az elérhetőségét',
      gomb: null,
      jelveny: 'Díjfizetésre vár',
      sulyos: false,
      sorrend: 3,
    };
  }
  return { kod: 'nincs', szoveg: '', gomb: null, jelveny: null, sulyos: false, sorrend: 9 };
}
