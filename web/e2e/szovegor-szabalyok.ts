// =====================================================================
//  SZÖVEGŐR-SZABÁLYOK — egy igazságforrás, három fogyasztó
//
//  ⚠️ EZ NEM SPEC-FÁJL (nincs benne test(), és Playwright-importja sincs):
//  a 13-as spec (marketing-oldalak megjelenített szövege), a 16-os spec
//  (az oldal-leltár BELÉPETT állapotai) és a web unit forrás-őr
//  (src/lib/szovegor-forras.test.ts — minden felhasználói szöveg a forrásban)
//  ugyanebből a listából dolgozik. Korábban a lista csak a 13-as specben élt,
//  és csak a marketing-oldalakat látta: az „élő GPS a mobilapp érkezésével”
//  és a „jogosítvány nem szükséges” így a belépett felületeken átcsúszott
//  (UX A05, 2026-10-08).
// =====================================================================

export type SzovegSzabaly = {
  pattern: RegExp;
  miert: string;
  /**
   * A belépett felületekre (16-os spec) és a forrás-őrre is vonatkozik.
   * Ami NEM: a csak marketing-oldalon tiltott fordulat (pl. a fizetőoldal a
   * kapcsolatfelvételi díj fizetéséről legitim módon beszélhet), illetve
   * amit a fixtúra-adat vagy egy kód-belső név (barion_* mezőnév) hamisan
   * kiváltana.
   */
  mindenhol?: boolean;
};

/** Az élő GPS / élő követés csak „hamarosan” — a mobil-fázisban jön (PR #48). */
const HAMAROSAN_NELKUL = '(?!.{0,40}(hamarosan|érkez))';

export const TILTOTT: SzovegSzabaly[] = [
  {
    pattern: /GoFuvar\s+Kft/i,
    miert: 'Nincs ilyen cég — az üzemeltető a Tiszta Hód Kft. (CLAUDE.md 4.)',
    mindenhol: true,
  },
  {
    pattern: /letét/i,
    miert: 'Escrow-kori szöveg. 2026-07-03 óta a fuvardíj közvetlenül a felek közt megy.',
  },
  {
    pattern: /\blicit(?!jeim)/i,
    miert: 'PR #71: user felé „ajánlat/ajánlattétel", a „licit" árverést sugall.',
  },
  {
    pattern: /jogosítvány/i,
    miert: 'A „jogosítvány nem kell" TILOS — ne hívjuk fel rá a figyelmet; '
      + 'a pozitív forma: „Szállítóként elég a személyi igazolványod.” (UX A05)',
    mindenhol: true,
  },
  {
    pattern: /olcsóbb,?\s+mint\s+egy\s+(dedikált|hagyományos)/i,
    miert: 'PR #64: tiltott összehasonlítás — helyette verseny-alapú megfogalmazás.',
  },
  {
    pattern: /te\s+szabod\s+az\s+árat/i,
    miert: 'PR #63: a szállító ad ajánlatot, a feladó dönt — nem a feladó szabja az árat.',
    mindenhol: true,
  },
  {
    pattern: /\bQR\b/i,
    miert: 'A QR kód 2026-08-06-án kikerült (user-döntés) — csak a 6 jegyű PIN van.',
  },
  {
    pattern: /(app\s*store|google\s*play)/i,
    miert: 'NINCS mobilapp — app-ígéret tilos (CLAUDE.md, PR #62).',
    mindenhol: true,
  },
  {
    pattern: /(töltsd le|letöltheted).{0,25}(appot|alkalmazást)/i,
    miert: 'NINCS mobilapp — letöltésre buzdítás tilos.',
    mindenhol: true,
  },
  {
    // UX A05 (2026-10-08): „A GoFuvar mobilalkalmazással érkezik”, „a GoFuvar
    // mobilapp érkezésével” — app-ígéret a főoldalon ÉS a fuvaroldalon.
    pattern: /mobil\s*-?\s*app|mobilalkalmaz/i,
    miert: 'NINCS mobilapp — app-ígéret tilos (UX A05). A funkciót ígérjük '
      + '(„hamarosan”), nem azt, hogy min keresztül jön.',
    mindenhol: true,
  },
  {
    pattern: /alkalmazással\s+érkez/i,
    miert: 'NINCS mobilapp — app-ígéret tilos (UX A05).',
    mindenhol: true,
  },
  {
    pattern: /barion/i,
    miert: 'A Barion 2026-08-09-én VÉGLEG törölve a kódból (a launch fizetése CIB '
      + 'bankkártyás vPOS). Egy nem létező szolgáltató megnevezése a felhasználó felé '
      + 'félrevezető — a 2. audit-kör a fizetőoldalon, a PWA-manifesztben és a '
      + 'foglalás-státuszban is megtalálta. A jogi oldalak (ÁSZF, adatkezelési) külön '
      + 'körben, ügyvédi átvezetéssel javulnak — azok nincsenek ebben a listában.',
  },
  {
    pattern: new RegExp(`(élő\\s+GPS|GPS[- ]követés)${HAMAROSAN_NELKUL}`, 'i'),
    miert: 'Az élő GPS csak a mobil-fázisban lesz — mindenhol „Hamarosan"-ként '
      + 'kommunikáljuk (PR #48). A PWA-manifeszt ezt 2026-08-09-ig meglévő '
      + 'funkcióként hirdette.',
    mindenhol: true,
  },
  {
    // UX A05: a mobilos térkép-gomb „Térkép és élő követés megjelenítése”
    // volt — ajánlatokra váró fuvaron is.
    pattern: new RegExp(`élő\\s+követés${HAMAROSAN_NELKUL}`, 'i'),
    miert: 'Élő követés még nincs (mobil-fázis) — csak „hamarosan”-ként '
      + 'említhető (UX A05).',
    mindenhol: true,
  },
  {
    pattern: /biztonságos\s+fizetés/i,
    miert: 'GF-024 (2026-08-30): escrow-kori maradvány — a kápé-modellben a '
      + 'platform a fuvardíjhoz nem nyúl, a „biztonságos fizetés" ígéret '
      + 'félrevezető. A bizalmi üzenet: fotó bizonyíték + 6 jegyű átvételi kód. '
      + '(A fizetőoldal a kapcsolatfelvételi díjról legitim módon beszélhet — '
      + 'az nem marketing-oldal, nincs ebben a listában.)',
  },
  {
    pattern: /biztonságos\s+fuvar/i,
    miert: 'UX A05/A19: a „biztonságos fuvar” többet ígér, mint amit a platform '
      + 'vállal (a platform közvetítő, nem fuvarozó; ÁSZF 5.2).',
    mindenhol: true,
  },
  {
    // 2026-09-10 (user-döntés): a fuvardíj fizetési módját a felek döntik el —
    // készpénz VAGY átutalás. A „készpénzes fizetés/fuvardíj" cím, a „kápé"
    // szleng, és a „készpénzben adod/kapod/jár" a közeli „átutalás" említése
    // nélkül mind kizárólagosságot sugall. A helyes minta: „közvetlenül a
    // szállítónak — készpénzben vagy átutalással, ahogy megegyeztek".
    pattern: /kápé|készpénzes\s+(fizetés|fuvardíj|fuvar|modell)|(kizárólag|csak)\s+készpénz|készpénzben\s+(adod|adsz|fizeted|fizetsz|kapod|kapsz|rendezed|jár|megy|a\s+tiéd|a\s+szállítóé)(?![^.]{0,80}átutalás)/i,
    miert: '2026-09-10 user-döntés: a fuvardíjat a felek úgy rendezik, ahogy '
      + 'megegyeznek (készpénz VAGY átutalás) — a felület sehol nem szűkítheti '
      + 'készpénzre. Minta: „közvetlenül a szállítónak — készpénzben vagy '
      + 'átutalással, ahogy megegyeztek".',
  },
  {
    pattern: /sikeres\s+fuvar\s+után\s+fizet/i,
    miert: 'GF-024 (2026-08-30): HAMIS ígéret volt — a kapcsolatfelvételi díj az '
      + 'ajánlat ELFOGADÁSAKOR esedékes és nem visszatérítendő (ÁSZF 4.), nem a '
      + 'fuvar sikere után. Helyette: „Csak akkor fizetsz, ha szállítót választasz".',
    mindenhol: true,
  },
];

/** A belépett felületekre és a forrás-őrre is érvényes szabályok. */
export const MINDENHOL_TILTOTT: SzovegSzabaly[] = TILTOTT.filter((r) => r.mindenhol);

/**
 * Az oldal-leltár útvonalai, ahol a MINDENHOL-szabályok NEM futnak:
 * a jogi oldalak tagadó szerkezetben legitim módon használják ezeket a
 * szavakat (ügyvédi review nézi át), az admin-felület pedig belső eszköz
 * (pl. a régi „Jogosítvány” dokumentumtípus címkéje).
 */
export function szovegorKivetel(utvonal: string): boolean {
  return /^\/(aszf|adatkezeles|admin)(\/|$)/.test(utvonal);
}

/** Találatok egy szövegben, olvasható környezettel. */
export function szovegorTalalatok(szoveg: string, szabalyok: SzovegSzabaly[]): string[] {
  const egysoros = szoveg.replace(/\s+/g, ' ');
  return szabalyok
    .filter((r) => r.pattern.test(egysoros))
    .map((r) => {
      const m = egysoros.match(r.pattern);
      const idx = m?.index ?? 0;
      const kornyezet = egysoros.slice(Math.max(0, idx - 60), idx + 80);
      return `  ✗ "${m?.[0]}" — ${r.miert}\n     Környezet: …${kornyezet}…`;
    });
}
