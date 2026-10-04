// =====================================================================
//  PUBLIKUS KONFIGURÁCIÓ — a teszt-üzem jelzése (CIB PR-5, C1, 2026-10-03)
//
//  A globális teszt-sáv eddig feltétel nélkül azt írta minden oldalon, hogy
//  „valódi pénzmozgás nincs" — a launch után is ott maradt volna, miközben a
//  kártyás díjat valódi pénzzel fizetik. Mostantól a GET /config/public
//  válasza dönt, és FAIL-CLOSED: hiányzó, hibás vagy ismeretlen alakú válasz
//  esetén nincs sáv — egy téves „nincs valódi pénz" állítás rosszabb, mint
//  egy elmaradt figyelmeztetés (a teszt-üzem élesben bent felejtését a
//  backend boot-riasztása és a fizetési kártya TesztFizetesSav-ja is jelzi).
// =====================================================================
import { api, type PublikusKonfig } from '@/api';

/** A válasz szigorú értelmezése: csak a pontos alak számít, minden más null. */
export function ervenyesKonfig(x: unknown): PublikusKonfig | null {
  if (!x || typeof x !== 'object' || Array.isArray(x)) return null;
  const o = x as Record<string, unknown>;
  if (typeof o.teszt_uzem !== 'boolean') return null;
  // A hiányzó kulcs nem „null" (= stub, „csak szimuláció"): az a
  // legmegengedőbb állítás volna — inkább semmi (a PR-5 web 1. javítóköre).
  if (!('kartyas_fizetes' in o)) return null;
  const kf = o.kartyas_fizetes;
  // Az ismeretlen környezet-név nem „teszt": éles kártyás fizetésnek vesszük,
  // vagyis semmilyen „nincs valódi pénz" állítás nem társul hozzá.
  const kartyas: PublikusKonfig['kartyas_fizetes'] = kf === 'teszt' ? 'teszt' : kf === null ? null : 'eles';
  // 2026-10-04 (végső kör): a szimulált díjfizetés csak kifejezett `true`-ra
  // „elérhető" — a hiány (régebbi backend) vagy más érték NEM szimuláció.
  return { teszt_uzem: o.teszt_uzem, kartyas_fizetes: kartyas, szimulalt_fizetes: o.szimulalt_fizetes === true };
}

export type TesztUzemSav = {
  /**
   * 'stub': csak szimuláció; 'cib_teszt': a bank tesztkörnyezete;
   * 'nem_elerheto': se kártyás, se szimulált díjfizetés; 'altalanos': éles kártyás mellett.
   */
  fajta: 'stub' | 'cib_teszt' | 'nem_elerheto' | 'altalanos';
  cim: string;
  szoveg: string;
};

/** A globális sáv tartalma — null: nincs sáv. */
export function tesztUzemSav(k: PublikusKonfig | null): TesztUzemSav | null {
  if (!k || k.teszt_uzem !== true) return null;
  if (k.kartyas_fizetes === 'teszt') {
    // 2026-10-04 (a PR-5 web 2. javítóköre): a mai vegyes üzemben (CIB-teszt
    // + stub) a felhasználók többsége szimulált díjfizetést lát, csak a
    // CIB-tesztfiókok fizetnek a bank tesztkörnyezetében — a konfiguráció ezt
    // fiókonként nem mondja meg, ezért a sáv mindkettőt említi. Ha a
    // szimuláció nem érhető el (végső kör), csak a bank tesztkörnyezetét.
    return {
      fajta: 'cib_teszt',
      cim: 'Teszt üzemmód.',
      szoveg: k.szimulalt_fizetes === true
        ? 'Az oldal tesztelés alatt áll — valódi terhelés nincs: a díjfizetés szimulált, vagy a CIB Bank tesztkörnyezetében fut, ahol csak a bank tesztkártyái működnek.'
        : 'Az oldal tesztelés alatt áll — valódi terhelés nincs: a kártyás díjfizetés a CIB Bank tesztkörnyezetében fut, ahol csak a bank tesztkártyái működnek.',
    };
  }
  if (k.kartyas_fizetes === null) {
    // 2026-10-04 (végső kör): „szimuláció" csak akkor, ha a szimulált
    // díjfizetés tényleg végigvihető. A hibás CIB-konfig (503), az éles
    // „biztonságos mód" vagy a zárt teszt-allowlist mellett nincs se kártyás,
    // se szimulált díjfizetés — a „szimuláció" ott hamis volt.
    if (k.szimulalt_fizetes === true) {
      return {
        fajta: 'stub',
        cim: 'Teszt üzemmód.',
        szoveg: 'Az oldal tesztelés alatt áll — valódi pénzmozgás nincs, a díjfizetés csak szimuláció.',
      };
    }
    return {
      fajta: 'nem_elerheto',
      cim: 'Teszt üzemmód.',
      szoveg: 'Az oldal tesztelés alatt áll — a kártyás díjfizetés jelenleg nem érhető el, valódi terhelés nincs.',
    };
  }
  // Éles kártyás fizetés mellett bent maradt teszt-üzem: jelezzük, de a
  // pénzről semmit nem állítunk (a kártyás díj itt VALÓDI pénz).
  return {
    fajta: 'altalanos',
    cim: 'Teszt üzemmód.',
    szoveg: 'Az oldal egyes funkciói tesztelés alatt állnak.',
  };
}

// Az egyidejű kérések egy hívásba olvadnak (a globális sáv és az
// eredményoldal egyszerre is kérdezhet). Tartós gyorsítótár szándékosan
// nincs: a konfiguráció a launchkor változik, és a fogyasztók
// oldalbetöltésenként egyszer kérdeznek.
let folyamatban: Promise<PublikusKonfig | null> | null = null;

/** A publikus konfiguráció; hibánál / ismeretlen alaknál null (fail-closed). */
export function publikusKonfig(): Promise<PublikusKonfig | null> {
  if (!folyamatban) {
    // A `Promise.resolve().then` a szinkron dobást (pl. egy régi mock
    // hiányzó metódusát) is elutasítássá alakítja — az oldal nem törik el.
    folyamatban = Promise.resolve()
      .then(() => api.getPublicConfig())
      .then((v) => ervenyesKonfig(v))
      .catch(() => null)
      .finally(() => { folyamatban = null; });
  }
  return folyamatban;
}
