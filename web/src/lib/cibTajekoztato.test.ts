import { describe, it, expect } from 'vitest';
import { CIB_RESZLETES_TAJEKOZTATO, CIB_ROVID_TAJEKOZTATO, GOFUVAR_KIEGESZITES } from './cibTajekoztato';

// 2026-10-10 — a CIB a honlap-teszt után írásban kérte, hogy a vásárlói
// tájékoztatója („eCom_CIB.fiz.taj_HU.docx") SZÓ SZERINT álljon a felületen.
// Ez az őr a bank EREDETI szövegéből (a dokumentum két része: a szaggatott
// vonal feletti rövid és az alatti részletes tájékoztató; a bank belső
// kitöltési megjegyzése nélkül) indul, elvégzi a bank által sárgával
// kiemelt szavak cseréjét — és PONTOSAN a lib/cibTajekoztato.ts szövegét kell
// kapnia. Egy „szépítés", egy kihagyott mondat (pl. a VeriSign- vagy a
// 90%-os), egy tegezésre átírt fordulat vagy egy elgépelés pirosra váltja.
//
// A cserélhető (sárgával kiemelt) szavak a bank dokumentumában: a
// „Webáruház" minden alakja, a „vásárolt áru/szolgáltatás" és az
// „árut/szolgáltatás". A csere a névelőt/ragot is igazítja, ahol a magyar
// nyelvtan megkívánja; minden csere PONTOSAN egyszer fordul elő.

const BANKI_ROVID = [
  'Webáruházunk a CIB Bank által biztosított biztonságos bankkártyás fizetési megoldást nyújtja vásárlóinak. A biztonságot az adatok szétválasztása alapozza meg. A Webáruház a megrendeléssel kapcsolatos információkat kapja meg a vásárlótól, a CIB Bank pedig kizárólag a fizetési tranzakcióhoz szükséges kártyaadatokat a 256 bites TLS titkosítással ellátott fizetőoldalon. A fizetőoldal adattartalmáról a Webáruház nem értesül, azokat csak a CIB Bank érheti el. A tranzakció eredményéről a fizetést követően a Webáruház oldala tájékoztatja. A kártyás fizetéshez az Ön internet böngésző programjának támogatnia kell a TLS titkosítást.',
  'A vásárolt áru/szolgáltatás ellenértéke, a kifizetett összeg azonnal zárolásra kerül kártyaszámláján. Kérjük, olvassa el részletes tájékoztatónkat!',
];

const BANKI_RESZLETES = [
  'Üdvözöljük a CIB Bank biztonságos, internetes fizetési megoldásával működő Webáruházunkban!',
  'Az alábbiakban röviden ismertetjük, hogy miképp intézheti biztonságos módon vásárlását.',
  'Mire figyeljen a vásárláskor?',
  'Olvassa el Webáruházunk ismertetőjét, a vásárlás kondícióit és a kiszállítás és a fizetés feltételeit!',
  'Tanulmányozza át a Webáruház biztonsági feltételeit, hiszen ezzel garantálják az Ön adatainak biztonságát!',
  'Tartsa nyilván a vásárlásával kapcsolatos adatait!',
  'Tartsa nyilván a fizetéssel kapcsolatos tranzakciós adatait! (tranzakció azonosító, engedélyszám)',
  'Biztosítsa, hogy titkos kártyaadataihoz illetéktelen személy soha ne férhessen hozzá.',
  'Használjon olyan böngészőt, amely támogatja a TLS titkosításhoz szükséges opciót!',
  'A biztonságról',
  'A TLS, a Transport Layer Security elfogadott titkosítási eljárás rövidítése. Bankunk rendelkezik egy 256 bites titkosító kulccsal, amely a kommunikációs csatornát védi. A VeriSign nevű cég teszi lehetővé a CIB Banknak a 256 bites kulcs használatát, amely segítségével biztosítjuk az TLS alapú titkosítást. Jelenleg a világ elektronikus kereskedelmének 90%-ában ezt a titkosítási módot alkalmazzák. A vásárló által használt böngésző program az TLS segítségével a kártyabirtokos adatait az elküldés előtt titkosítja, így azok kódolt formában jutnak el a CIB Bankhoz, ezáltal illetéktelen személyek számára nem értelmezhetőek.',
  'Elfogadott kártyák',
  'A CIB Bank internetes fizetési rendszere a Mastercard/Maestro, a VISA termékcsaládba tartozó VISA és VISA Electron (az Electronnál csak abban az esetben, ha azt a kibocsátó bank engedélyezi) bankkártyák használatát, valamint internetes használatra alkalmas webkártyával való fizetést teszi lehetővé.',
  'Fizetés lépései',
  'Ön a Webáruház oldalán választja ki az árut/szolgáltatás melynek összegét bankkártyás fizetéssel kívánja teljesíteni.',
  'Ezt követően Ön átkerül a CIB Bank biztonságos fizetést garantáló oldalára, ahol a fizetés megkezdéséhez kártyaadatait szükséges kitöltenie.',
  'A kártyaadatok megadását követően a Fizetés gombra kattintva indíthatja el a tranzakciót.',
  'A sikeres hitelesítést követően folytatódik a fizetési folyamat.',
  'A fizetést követően Ön visszatér a Webáruház oldalára, ahol a tranzakció eredményéről kap visszaigazolást.',
  'A bankkártyával történő fizetés esetén a sikeres tranzakciót követően – ez a bankkártya érvényessége és a fedezet ellenőrzése utáni elfogadást jelenti –, a CIB Bank elindítja a Kártyabirtokos számlájának megterhelését az áru vagy szolgáltatás ellenértékével.',
  'Amennyiben Ön nem kerül visszairányításra a fizetőoldalról a Webáruház oldalára, úgy a tranzakció sikertelennek minősül. Amennyiben a banki fizetőoldalon a böngésző „Vissza/Back” vagy a „Frissítés/Refresh” gombjára kattint, ill. bezárja a böngésző ablakot mielőtt visszairányításra kerülne az áruházba, a fizetés sikertelennek minősül.',
  'Amennyiben a tranzakció eredményéről, annak sikertelensége esetén, okáról, részleteiről bővebben kíván tájékozódni, kérjük, vegye fel a kapcsolatot számlavezető bankjával.',
];

/** [banki eredeti, GoFuvar-változat] — mind pontosan egyszer szerepel. */
const CSEREK: ReadonlyArray<readonly [string, string]> = [
  ['Webáruházunk a CIB Bank által', 'A GoFuvar a CIB Bank által'],
  ['A Webáruház a megrendeléssel', 'A GoFuvar a megrendeléssel'],
  ['adattartalmáról a Webáruház nem értesül', 'adattartalmáról a GoFuvar nem értesül'],
  ['a Webáruház oldala tájékoztatja', 'a GoFuvar oldala tájékoztatja'],
  ['A vásárolt áru/szolgáltatás ellenértéke', 'A kapcsolatfelvételi szolgáltatás ellenértéke'],
  ['működő Webáruházunkban!', 'működő GoFuvaron!'],
  ['Olvassa el Webáruházunk ismertetőjét', 'Olvassa el a GoFuvar ismertetőjét'],
  ['Tanulmányozza át a Webáruház biztonsági', 'Tanulmányozza át a GoFuvar biztonsági'],
  ['Ön a Webáruház oldalán választja ki az árut/szolgáltatás melynek', 'Ön a GoFuvar oldalán választja ki a kapcsolatfelvételi díjat, melynek'],
  ['visszatér a Webáruház oldalára', 'visszatér a GoFuvar oldalára'],
  ['a fizetőoldalról a Webáruház oldalára', 'a fizetőoldalról a GoFuvar oldalára'],
];

function cserel(sorok: readonly string[]): { sorok: string[]; szamlalo: Map<string, number> } {
  const szamlalo = new Map<string, number>();
  const ki = sorok.map((sor) => {
    let s = sor;
    for (const [mit, mire] of CSEREK) {
      const db = s.split(mit).length - 1;
      if (db) szamlalo.set(mit, (szamlalo.get(mit) ?? 0) + db);
      s = s.split(mit).join(mire);
    }
    return s;
  });
  return { sorok: ki, szamlalo };
}

/** A lib szövege a dokumentum sorrendjében, soronként. */
function libRovid(): string[] {
  const [elso, masodik] = CIB_ROVID_TAJEKOZTATO.bekezdesek;
  return [elso, `${masodik} ${CIB_ROVID_TAJEKOZTATO.reszletesLink}`];
}
function libReszletes(): string[] {
  const b = CIB_RESZLETES_TAJEKOZTATO;
  return [
    ...b.bevezeto,
    b.mireFigyeljen.cim, ...b.mireFigyeljen.pontok,
    b.biztonsag.cim, ...b.biztonsag.bekezdesek,
    b.kartyak.cim, ...b.kartyak.bekezdesek,
    b.lepesek.cim, ...b.lepesek.pontok, ...b.lepesek.utana,
  ];
}

describe('a CIB vásárlói tájékoztatója — szó szerint, csak a kiemelt szavak cseréjével', () => {
  it('minden csere pontosan egyszer fordul elő a banki eredetiben', () => {
    const { szamlalo } = cserel([...BANKI_ROVID, ...BANKI_RESZLETES]);
    for (const [mit] of CSEREK) expect(szamlalo.get(mit), mit).toBe(1);
  });

  it('a rövid tájékoztató (fizetési kártya) betűre a banké', () => {
    expect(libRovid()).toEqual(cserel(BANKI_ROVID).sorok);
  });

  it('a részletes tájékoztató (/bankkartyas-fizetes) betűre a banké, a bank címsoraival', () => {
    expect(libReszletes()).toEqual(cserel(BANKI_RESZLETES).sorok);
    expect([
      CIB_RESZLETES_TAJEKOZTATO.mireFigyeljen.cim, CIB_RESZLETES_TAJEKOZTATO.biztonsag.cim,
      CIB_RESZLETES_TAJEKOZTATO.kartyak.cim, CIB_RESZLETES_TAJEKOZTATO.lepesek.cim,
    ]).toEqual(['Mire figyeljen a vásárláskor?', 'A biztonságról', 'Elfogadott kártyák', 'Fizetés lépései']);
  });

  it('nem maradt sablon-szó és banki belső megjegyzés; a nem kiemelt szavak a banké', () => {
    const minden = [...libRovid(), ...libReszletes()].join(' ');
    expect(minden).not.toMatch(/Webáruház/i);
    expect(minden).not.toMatch(/áru\/szolgáltatás|árut\/szolgáltatás/);
    expect(minden).not.toMatch(/sárgával kiemelt/i);
    // A NEM kiemelt szavak a bank szövegében maradnak (nem „javítjuk" őket).
    for (const banki of ['az áruházba', 'az áru vagy szolgáltatás ellenértékével', 'vásárlóinak', 'VeriSign', '90%-ában', 'az TLS']) {
      expect(minden, banki).toContain(banki);
    }
    // Magázás: a banki szöveg nem lett tegezve.
    expect(minden).toMatch(/Üdvözöljük/);
    expect(minden).not.toMatch(/\b(fizetsz|adod meg|olvasd el|figyelj)\b/i);
  });
});

describe('„A GoFuvar kiegészítése" — külön, a banki szövegen kívül', () => {
  it('kimondja az ismert eltérést: a vissza nem irányított, jóváhagyott fizetést is lekérdezzük', () => {
    expect(GOFUVAR_KIEGESZITES.cim).toBe('A GoFuvar kiegészítése');
    const k = GOFUVAR_KIEGESZITES.visszateres;
    expect(k).toMatch(/jóváhagyta \(például a bankja alkalmazásában\)/);
    expect(k).toMatch(/nem került vissza a GoFuvar oldalára/);
    expect(k).toMatch(/lekérdezzük a banktól, és e-mailben értesítjük/);
    expect(k).toMatch(/sikeres volt, a fuvar oldalán megjelennek a szállító elérhetőségei/);
    expect(k).toMatch(/kártyáját nem terheljük meg, a zárolt összeget pedig a bank feloldja/);
    // Ugyanaz a magázó hangnem, mint a banki szövegé.
    expect(k).not.toMatch(/\b(jóváhagytad|kerültél|értesítünk téged)\b/i);
    // A kiegészítés nem keveredik a banki szövegbe.
    expect(libReszletes().join(' ')).not.toContain('lekérdezzük a banktól');
  });
});
