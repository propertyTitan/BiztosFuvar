// =====================================================================
//  A CIB BANK VÁSÁRLÓI TÁJÉKOZTATÓJA — SZÓ SZERINT (egy forrásból)
//
//  2026-10-10 — A CIB BANK ÍRÁSOS KÉRÉSE (a honlap-teszt után): „A banki
//  fizetési tájékoztató nem megfelelő. Kérjük, hogy a Technikai
//  dokumentáció „Vásárlói tájékoztatás" mappájában szereplő
//  „eCom_CIB.fiz.taj_HU.docx" dokumentum tartalmát használja. A fizetési
//  tájékoztató GYFK megfelelő."
//
//  A korábbi változat (CIB PR-3) a banki szöveget ÁTÍRTA: tegező hangnem, a
//  VeriSign-mondat és a „90%" kihagyva, a lépések a mi folyamatunkra
//  igazítva. A bank ezt nem fogadta el — mostantól a dokumentum szövege
//  BETŰRE áll itt. Csak a bank által sárgával kiemelt (cserélhető) szavak
//  változtak, a nyelvtanilag szükséges névelővel/raggal:
//   - „Webáruház" minden alakja → „GoFuvar" („A GoFuvar …", „a GoFuvar
//     oldalán", „… működő GoFuvaron!");
//   - „vásárolt áru/szolgáltatás" → „kapcsolatfelvételi szolgáltatás";
//   - „az árut/szolgáltatás" → „a kapcsolatfelvételi díjat,".
//  Minden más (a magázás, a „biztonságos", a TLS-, VeriSign- és 90%-os
//  mondat, az elfogadott kártyák mondata, a lépések, az „áruházba" és az
//  „áru vagy szolgáltatás ellenértékével") a bank szövege, változatlanul —
//  ne fogalmazd át, ne „javítsd". A bank belső kitöltési megjegyzése (a
//  sárga kiemelésről) nem kerül a felületre.
//  Őr: cibTajekoztato.test.ts — a banki eredetiből a fenti cserékkel
//  pontosan ezt a szöveget kell kapnia.
//
//  A GoFuvar saját mondatai KÜLÖN, „A GoFuvar kiegészítése" cím alatt
//  állnak (GOFUVAR_KIEGESZITES) — a banki szövegbe nem írunk bele.
// =====================================================================

/** A rövid tájékoztató — a fizetési kártyán (CibFizetesInfo). */
export const CIB_ROVID_TAJEKOZTATO = {
  bekezdesek: [
    'A GoFuvar a CIB Bank által biztosított biztonságos bankkártyás fizetési megoldást nyújtja vásárlóinak. '
      + 'A biztonságot az adatok szétválasztása alapozza meg. A GoFuvar a megrendeléssel kapcsolatos '
      + 'információkat kapja meg a vásárlótól, a CIB Bank pedig kizárólag a fizetési tranzakcióhoz szükséges '
      + 'kártyaadatokat a 256 bites TLS titkosítással ellátott fizetőoldalon. A fizetőoldal adattartalmáról a '
      + 'GoFuvar nem értesül, azokat csak a CIB Bank érheti el. A tranzakció eredményéről a fizetést követően '
      + 'a GoFuvar oldala tájékoztatja. A kártyás fizetéshez az Ön internet böngésző programjának támogatnia '
      + 'kell a TLS titkosítást.',
    'A kapcsolatfelvételi szolgáltatás ellenértéke, a kifizetett összeg azonnal zárolásra kerül kártyaszámláján.',
  ],
  /** A második bekezdés záró mondata — link a részletes tájékoztatóra. */
  reszletesLink: 'Kérjük, olvassa el részletes tájékoztatónkat!',
} as const;

/** A részletes tájékoztató — a /bankkartyas-fizetes oldalon. */
export const CIB_RESZLETES_TAJEKOZTATO = {
  bevezeto: [
    'Üdvözöljük a CIB Bank biztonságos, internetes fizetési megoldásával működő GoFuvaron!',
    'Az alábbiakban röviden ismertetjük, hogy miképp intézheti biztonságos módon vásárlását.',
  ],
  mireFigyeljen: {
    cim: 'Mire figyeljen a vásárláskor?',
    pontok: [
      'Olvassa el a GoFuvar ismertetőjét, a vásárlás kondícióit és a kiszállítás és a fizetés feltételeit!',
      'Tanulmányozza át a GoFuvar biztonsági feltételeit, hiszen ezzel garantálják az Ön adatainak biztonságát!',
      'Tartsa nyilván a vásárlásával kapcsolatos adatait!',
      'Tartsa nyilván a fizetéssel kapcsolatos tranzakciós adatait! (tranzakció azonosító, engedélyszám)',
      'Biztosítsa, hogy titkos kártyaadataihoz illetéktelen személy soha ne férhessen hozzá.',
      'Használjon olyan böngészőt, amely támogatja a TLS titkosításhoz szükséges opciót!',
    ],
  },
  biztonsag: {
    cim: 'A biztonságról',
    bekezdesek: [
      'A TLS, a Transport Layer Security elfogadott titkosítási eljárás rövidítése. Bankunk rendelkezik egy '
        + '256 bites titkosító kulccsal, amely a kommunikációs csatornát védi. A VeriSign nevű cég teszi '
        + 'lehetővé a CIB Banknak a 256 bites kulcs használatát, amely segítségével biztosítjuk az TLS alapú '
        + 'titkosítást. Jelenleg a világ elektronikus kereskedelmének 90%-ában ezt a titkosítási módot '
        + 'alkalmazzák. A vásárló által használt böngésző program az TLS segítségével a kártyabirtokos adatait '
        + 'az elküldés előtt titkosítja, így azok kódolt formában jutnak el a CIB Bankhoz, ezáltal illetéktelen '
        + 'személyek számára nem értelmezhetőek.',
    ],
  },
  kartyak: {
    cim: 'Elfogadott kártyák',
    bekezdesek: [
      'A CIB Bank internetes fizetési rendszere a Mastercard/Maestro, a VISA termékcsaládba tartozó VISA és '
        + 'VISA Electron (az Electronnál csak abban az esetben, ha azt a kibocsátó bank engedélyezi) bankkártyák '
        + 'használatát, valamint internetes használatra alkalmas webkártyával való fizetést teszi lehetővé.',
    ],
  },
  lepesek: {
    cim: 'Fizetés lépései',
    pontok: [
      'Ön a GoFuvar oldalán választja ki a kapcsolatfelvételi díjat, melynek összegét bankkártyás fizetéssel kívánja teljesíteni.',
      'Ezt követően Ön átkerül a CIB Bank biztonságos fizetést garantáló oldalára, ahol a fizetés megkezdéséhez kártyaadatait szükséges kitöltenie.',
      'A kártyaadatok megadását követően a Fizetés gombra kattintva indíthatja el a tranzakciót.',
      'A sikeres hitelesítést követően folytatódik a fizetési folyamat.',
      'A fizetést követően Ön visszatér a GoFuvar oldalára, ahol a tranzakció eredményéről kap visszaigazolást.',
    ],
    utana: [
      'A bankkártyával történő fizetés esetén a sikeres tranzakciót követően – ez a bankkártya érvényessége és '
        + 'a fedezet ellenőrzése utáni elfogadást jelenti –, a CIB Bank elindítja a Kártyabirtokos számlájának '
        + 'megterhelését az áru vagy szolgáltatás ellenértékével.',
      'Amennyiben Ön nem kerül visszairányításra a fizetőoldalról a GoFuvar oldalára, úgy a tranzakció '
        + 'sikertelennek minősül. Amennyiben a banki fizetőoldalon a böngésző „Vissza/Back” vagy a '
        + '„Frissítés/Refresh” gombjára kattint, ill. bezárja a böngésző ablakot mielőtt visszairányításra '
        + 'kerülne az áruházba, a fizetés sikertelennek minősül.',
      'Amennyiben a tranzakció eredményéről, annak sikertelensége esetén, okáról, részleteiről bővebben kíván '
        + 'tájékozódni, kérjük, vegye fel a kapcsolatot számlavezető bankjával.',
    ],
  },
} as const;

/**
 * „A GoFuvar kiegészítése" — a banki szöveg UTÁN, attól vizuálisan
 * elválasztva. Az első bekezdés az ISMERT ELTÉRÉST mondja ki nyíltan: a
 * banki szöveg szerint a vissza nem irányított tranzakció sikertelen, a
 * GoFuvar viszont (a bank által elfogadott módon) ilyenkor is lekérdezi az
 * eredményt, és a jóváhagyott fizetést lezárhatja. A banki mondat ettől
 * még szó szerint marad — a kiegészítés megmondja, mi történik nálunk.
 */
export const GOFUVAR_KIEGESZITES = {
  cim: 'A GoFuvar kiegészítése',
  visszateres:
    'Ha a fizetést jóváhagyta (például a bankja alkalmazásában), de nem került vissza a GoFuvar oldalára, '
    + 'a fizetés eredményét lekérdezzük a banktól, és e-mailben értesítjük róla. Ha a fizetés sikeres volt, '
    + 'a fuvar oldalán megjelennek a szállító elérhetőségei; ellenkező esetben kártyáját nem terheljük meg, '
    + 'a zárolt összeget pedig a bank feloldja.',
} as const;
