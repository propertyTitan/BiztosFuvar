// =====================================================================
//  CIB KÁRTYÁS DÍJFIZETÉS — a web tiszta (tesztelhető) logikája
//
//  A fizetési kártya és az eredményoldal döntései ide kerültek, hogy
//  komponens nélkül is mérhetők legyenek:
//   - a kártya állapota a GET /jobs/:id/fee-payment válaszából;
//   - a /pay hibakódjaihoz FIX magyar szöveg (nyers szerver- vagy banki
//     szöveg SOHA nem jut a felhasználóhoz — a backend sem küld ilyet, de a
//     web sem bízik ebben);
//   - az eredményoldal lekérdezési üteme (3 mp-enként 3 percig, utána 20 mp).
// =====================================================================
import { HALOZATI_HIBA_UZENET, IDOTULLEPES_UZENET, type FeePaymentAllapot } from '@/api';

export type KartyaAllapot =
  /** Nincs függő kísérlet (vagy stub / ismeretlen): pipa + gomb. */
  | 'alap'
  /** Egy korábbi kísérlet a bankhoz ment, de nem tért vissza — újat indíthat. */
  | 'nyitott'
  /** Egy kísérlet feldolgozása / lezárása fut — a gomb rejtve, 5 mp-es
   *  frissítés; ha elhúzódik (lezarasKesik), a doboz percekről beszél. */
  | 'lezaras'
  /** A díjfizetés sikerült — a gomb rejtve, a fuvart EGYSZER újratöltjük
   *  (megnyílik a kontakt), a lekérdezés leáll. */
  | 'sikeres'
  /** Kétes lezárás (close_unknown / needs_review) — „Ne fizess újra". */
  | 'ellenorzes'
  /** Az előző kísérlet sikertelen / nem terhelt — magyarázat + újrapróba. */
  | 'elozo_sikertelen';

// Az `allapot` mező két szótárral is érkezhet: az eredményoldaléval
// ('feldolgozas' / 'ellenorzes' / …) vagy a nyers CIB-alállapottal. Mindkettőt
// elfogadjuk, hogy a backend apró szótár-döntése ne törje a felületet.
//
// ⚠️ A 'sikeres' KÜLÖN állapot, NEM a lezárásé: a lezárás alatt a kártya
// 5 mp-enként kérdez, és csak a lezárásból KILÉPVE tölti újra a fuvart — ha a
// siker is „lezárás" volna, a kártya sosem lépne ki belőle (végtelen lekérdezés,
// a kontakt csak a socket-eseményen múlna). A 'closed_ok' viszont marad a
// lezárásnál: a terv szerint a banki lezárás után a könyvelés még függőben
// lehet (closed_ok + pending = 'feldolgozas').
const ELLENORZES = new Set(['ellenorzes', 'close_unknown', 'needs_review']);
const SIKERES = new Set(['sikeres', 'succeeded']);
const LEZARAS = new Set(['lezaras', 'authorized', 'closing', 'closed_ok']);
const SIKERTELEN = new Set(['sikertelen', 'nem_terhelt', 'mar_fizetve', 'visszateritve', 'failed', 'expired', 'not_closed', 'abandoned', 'init_failed']);

/**
 * A „feldolgozas" a bankhoz ment, vissza nem tért kísérletet ÉS a lezárás
 * alattit is jelentheti: a `can_pay` és a tiltás oka dönt. A lezárás-doboz
 * csak akkor jön, ha a fizetést egy MÁSIK kísérlet tiltja (vagy a régi
 * backend ok nélkül tiltja); a többi okot (korlát, szünet, nem fizethető) a
 * kártya külön mondja el — azok mellett a nyitott kísérlet sávja marad.
 * ⚠️ A can_pay=false egy másik fülben ÉPP INDULÓ kísérletet is jelenthet,
 * ezért a lezárás-doboz szövege semleges (nem állít banki jóváhagyást).
 * ⚠️ A backend a lezárás alatti (authorized/closing) és a — stub-úton vagy
 * hiányos konfignál — a bank oldalán hagyott kísérletet UGYANÍGY adja
 * („feldolgozas" + másik kísérlet); a kettőt csak az idő választja el
 * (lezarasKesik, a PR-5 web 2. javítóköre).
 */
function feldolgozasAllapota(fp: FeePaymentAllapot): KartyaAllapot {
  if (fp.can_pay !== false) return 'nyitott';
  const ok = fp.pay_blocked_reason;
  return !ok || ok === 'masik_kiserlet_folyamatban' ? 'lezaras' : 'nyitott';
}

/**
 * Ennyi lezárás-állapotban töltött idő után a doboz már nem „pár
 * másodpercet" ígér: egy valódi lezárás (a MSGT32 időkerete ~45 mp) addigra
 * jellemzően véget ér; ami tovább tart, az a bank oldalán hagyott kísérlet
 * is lehet, amit a bank csak ~10 perc után zár le.
 */
export const LEZARAS_KESES_MS = 60_000;

/**
 * Elhúzódik-e a lezárás (a doboz percekről és kiútról beszél)? 2026-10-04
 * (a PR-5 web 2. javítóköre): eddig a doboz a stub-útra került fiók bank
 * oldalán hagyott kísérletére is „pár másodperc"-et mondott, és vég nélkül
 * kérdezett. Nem kártyás úton (stub / allowlist-váltás) ez a gyakori eset,
 * ott rögtön a hosszabb magyarázat jön.
 */
export function lezarasKesik(fp: Pick<FeePaymentAllapot, 'provider_kind'> | null | undefined, elteltMs: number): boolean {
  return fp?.provider_kind !== 'cib' || elteltMs >= LEZARAS_KESES_MS;
}

export function kartyaAllapot(fp: FeePaymentAllapot | null | undefined): KartyaAllapot {
  if (!fp) return 'alap';
  // 2026-10-03 (CIB PR-5, C3 — lelet 24): a provider_kind NEM rejti el a
  // függő kísérletet. Ha a fiók közben stub-útra került (allowlist-váltás),
  // egy close_unknown kísérletre eddig stub-gomb és sárga sáv jött „Ne fizess
  // újra" helyett; a backend a nem végállapotú CIB-kísérletet ilyenkor is
  // jelenti, a kártya pedig ugyanúgy mutatja.
  const oa = fp.open_attempt;
  const lr = fp.last_result;
  const aOa = oa ? String(oa.allapot || '') : null;
  const aLr = lr ? String(lr.allapot || '') : null;
  // Lelet 25a: az ellenőrzés MINDIG elsőbbséget kap — egy újabb, futó
  // kísérlet nem takarhatja el a „Ne fizess újra" dobozt.
  if ((aOa !== null && ELLENORZES.has(aOa)) || (aLr !== null && ELLENORZES.has(aLr))) return 'ellenorzes';
  if (aOa !== null) {
    if (SIKERES.has(aOa)) return 'sikeres';
    if (LEZARAS.has(aOa)) return 'lezaras';
    return feldolgozasAllapota(fp);
  }
  if (aLr !== null) {
    if (SIKERES.has(aLr)) return 'sikeres';
    if (LEZARAS.has(aLr)) return 'lezaras';
    if (aLr === 'feldolgozas') return feldolgozasAllapota(fp);
    if (SIKERTELEN.has(aLr)) return 'elozo_sikertelen';
  }
  return 'alap';
}

/**
 * Miért nem fizethető most a díj (`can_pay: false`) — a kártya ezt mondja el
 * a (rejtett) fizetés-gomb helyén. 2026-10-03 (CIB PR-5, C3 — lelet 25):
 * eddig a gomb látszott, és csak a kattintás után derült ki a tiltás.
 * `can_pay: true` (vagy ismeretlen állapot) esetén null.
 */
export function fizetesTiltasUzenet(fp: FeePaymentAllapot | null | undefined): Omit<HibaUzenet, 'teendo'> | null {
  if (!fp || fp.can_pay !== false) return null;
  switch (fp.pay_blocked_reason) {
    case 'masik_kiserlet_folyamatban':
      return {
        cim: 'Egy korábbi fizetésed még folyamatban van',
        szoveg: 'Egy korábbi fizetésed feldolgozása vagy egyeztetése még tart. Ne indíts újat — amint lezárul, itt és e-mailben is értesítünk, és kétszer biztosan nem terhelünk.',
      };
    case 'probalkozasi_limit':
      return {
        cim: 'Túl sok fizetési kísérlet',
        szoveg: 'Túl sok fizetést indítottál ennél a fuvarnál, ezért az újabbat átmenetileg nem engedjük. Próbáld újra később (akár csak holnap); ha elakadtál, írj nekünk: info@gofuvar.hu.',
      };
    case 'szunetel':
      return {
        cim: 'A kártyás fizetés átmenetileg szünetel',
        // „Nem történt terhelés" szándékosan nincs benne (egy már elindított
        // fizetés szünet alatt is lezárulhat), és lezárást sem ígérünk:
        // 2026-10-04 (a PR-5 web 2. javítóköre) — a backend a hiányos
        // CIB-konfigot is szünetnek adja, ott a lekérdező kör nem fut.
        szoveg: 'Új kártyás fizetés most nem indítható. Ha korábban elindítottál egyet, ne indíts újat — kétszer nem terhelünk. Próbáld újra később; ha sürgős, írj nekünk: info@gofuvar.hu.',
      };
    case 'nem_fizetheto':
      return {
        cim: 'A díj most nem fizethető',
        szoveg: 'A fuvar állapota közben megváltozott, ezért a díj most nem fizethető. Frissítsd az oldalt, és nézd meg, kell-e még fizetned.',
      };
    default:
      return {
        cim: 'A fizetés most nem indítható',
        szoveg: 'A díjfizetés most nem indítható. Próbáld újra pár perc múlva; ha ismétlődik, írj nekünk: info@gofuvar.hu.',
      };
  }
}

/**
 * A „nem terhelt" kimenet magyarázata az ok szerint (C5). 2026-10-03 (CIB
 * PR-5, lelet 9): az admin „nem lezárva" döntése után a felület eddig azt
 * írta, „a bank nem fogadta el a fizetést" / „a fuvar közben megváltozott" —
 * mindkettő hamis volt (a bank jóváhagyta, a fuvar fagyasztva állt).
 */
export function nemTerheltMagyarazat(ok: string | null | undefined): string {
  if (ok === 'admin_nem_lezarva') {
    return 'A bankkal egyeztettük: ezt a fizetést nem zártuk le, ezért a kártyádat nem terheltük. A zárolt összeget a bank feloldja (a kivonaton pár napig függő tételként látszhat).';
  }
  if (ok === 'bank_visszaforditotta') {
    // Múlt időben, a backend értesítésével egyezően (a PR-5 web 2. javítóköre).
    return 'A bank ezt a fizetést lezárás nélkül visszafordította, és a zárolást feloldotta — a kártyádat nem terheltük (a kivonaton pár napig még függő tételként látszhat).';
  }
  return 'Nem terheltük a kártyádat. A zárolt összeget a bank feloldja (a kivonaton pár napig függő tételként látszhat).';
}

/** A visszatérítés okai (a C5 bővítése, 2026-10-04): az admin a banknál visszatérítette a díjat. */
export const VISSZATERITES_OKOK: readonly string[] = ['admin_visszaterites', 'visszateritve'];

/**
 * Visszatérített-e a kísérlet: a bank TERHELT, a díjat visszautaltuk
 * (könyvelési árva, admin-visszatérítés). 2026-10-04 (a PR-5 web 2.
 * javítóköre, BLOKKOLÓ): a backend ezt „nem_terhelt" kimenettel adja ki, és
 * a felület eddig „Nem terheltük a kártyádat"-ot írt rá — hamis pénzügyi
 * állítás. A kifejezett ok / saját állapot mellett a banki RC is dönt: egy
 * „nem terhelt" kimenet RC=00-val (a bank a tranzakciót lezárta) a kötelező
 * adatsor saját kódjának mondana ellent — ilyen kísérletnél a terhelést
 * soha nem tagadjuk.
 */
export function visszateritett(a: { allapot?: string | null; ok?: string | null; rc?: string | null } | null | undefined): boolean {
  if (!a) return false;
  if (a.allapot === 'visszateritve') return true;
  if (a.allapot !== 'nem_terhelt') return false;
  return (!!a.ok && VISSZATERITES_OKOK.includes(a.ok)) || a.rc === '00';
}

/** A visszatérített kísérlet magyarázata (a backend „visszateritve" értesítésével egyező tartalom). */
export function visszateritesMagyarazat(): string {
  return 'A bank ezt a fizetést terhelte, de a díjat ehhez a fuvarhoz már nem tudtuk elszámolni, ezért visszatérítettük a kártyádra. A jóváírás ideje a bankodtól függ; a kivonatodon a terhelés és a visszatérítés is látszhat.';
}

/**
 * A vissza nem tért kísérlet sávjának szövege. 2026-10-04 (a PR-5 web 2.
 * javítóköre): ha új fizetés most nem indítható (szünet, korlát, nem
 * fizethető — a kártya ezt külön dobozban mondja el), a sáv nem biztat új
 * fizetésre.
 */
export function nyitottSavSzoveg(startedAt: string | null | undefined, ujIndithato: boolean, most = Date.now()): string {
  const alap = `Egy korábbi fizetésed ${percKiiras(startedAt, most)} indult, és nem fejeződött be. Ha a bank oldalán befejezted a fizetést, ne indíts újat: pár percen belül itt és e-mailben is megjelenik az eredmény.`;
  return ujIndithato
    ? `${alap} Ha fizetés nélkül bezártad a bank oldalát, indíts újat — kétszer biztosan nem terhelünk.`
    : alap;
}

/**
 * Az elhúzódó lezárás-doboz szövege (lezarasKesik): egy korábbi, a bank
 * oldalán is lehető kísérlet miatt most nem fizethet. A bank a magára
 * hagyott kísérletet ~9,5–11 perc után zárja (mérve a teszt-banknál), a
 * lekérdező kör ezt percen belül észleli — ezért negyedórát mondunk, nem
 * másodperceket.
 */
export function folyamatbanSzoveg(startedAt: string | null | undefined, most = Date.now()): string {
  return `Egy korábbi fizetésed ${percKiiras(startedAt, most)} indult, és még folyamatban van, ezért most ne indíts újat — kétszer biztosan nem terhelünk. Ha a bank oldalán befejezted, pár percen belül itt és e-mailben is megjelenik az eredmény. Ha fizetés nélkül bezártad a bank oldalát, a bank a félbehagyott fizetést magától lezárja (ez legfeljebb kb. negyedóra), utána itt új fizetést indíthatsz. Ha sokáig nem változik, írj nekünk: info@gofuvar.hu.`;
}

/**
 * Melyik nyilatkozat hiányzik a fizetés gombjához (lelet 29). A letiltott
 * gombra kattintás nem fut le, ezért ezt a gomb mellett, a gombhoz kötve
 * mondjuk el. null: minden megvan.
 */
export function nyilatkozatHiany(p: { consent: boolean; cibHozzajarulas: boolean; cibUt: boolean }): string | null {
  const cibHianyzik = p.cibUt && !p.cibHozzajarulas;
  if (!p.consent && cibHianyzik) {
    return 'A fizetéshez pipáld ki mindkét nyilatkozatot: az azonnali teljesítésről és a CIB Bank felé történő adattovábbításról szólót.';
  }
  if (!p.consent) return 'A fizetéshez pipáld ki az azonnali teljesítésről szóló nyilatkozatot.';
  if (cibHianyzik) return 'A fizetéshez pipáld ki a CIB Bank felé történő adattovábbításról szóló nyilatkozatot.';
  return null;
}

export type HibaUzenet = {
  cim: string;
  szoveg: string;
  /** 'allapot' → a díjfizetési állapotot kell újraolvasni; 'fuvar' → a fuvart. */
  teendo: 'allapot' | 'fuvar' | null;
};

const FIX: Record<string, HibaUzenet> = {
  STATE_CHANGED: {
    cim: 'Megváltozott a fuvar állapota',
    szoveg: 'A fuvar fizetési állapota időközben megváltozott, ezért frissítettük az oldalt. Nézd meg, kell-e még fizetned.',
    teendo: 'fuvar',
  },
  PAYMENT_RECONCILIATION_REQUIRED: {
    cim: 'Egyeztetés szükséges',
    szoveg: 'Egy korábbi fizetésed állapotát előbb egyeztetnünk kell. Új fizetést nem indítottunk, és nem történt terhelés. Írj nekünk: info@gofuvar.hu.',
    teendo: 'allapot',
  },
  CIB_PAYMENT_FINISHING: {
    cim: 'A fizetésed épp lezárul',
    szoveg: 'Egy korábbi fizetésed lezárása épp folyamatban van. Ne indíts újat — pár másodperc múlva frissül az oldal.',
    teendo: 'allapot',
  },
  CIB_PAYMENT_REVIEW: {
    cim: 'Ne fizess újra',
    szoveg: 'A bank válaszát egyeztetjük. Ne fizess újra; legkésőbb 1 munkanapon belül rendezzük, és kétszer biztosan nem terhelünk.',
    teendo: 'allapot',
  },
  PAYMENT_STARTING: {
    cim: 'A fizetés már indul',
    szoveg: 'A fizetés indítása már folyamatban van (például egy másik ablakban). Várj pár másodpercet, majd próbáld újra.',
    teendo: null,
  },
  FEE_PAYMENT_FINALIZING: {
    cim: 'A fizetésed épp lezárul',
    szoveg: 'A díjfizetésed lezárása folyamatban van, ezért ez a művelet most nem végezhető el. Próbáld egy perc múlva.',
    teendo: 'allapot',
  },
  // 2026-10-03 (CIB PR-5, lelet 30): a backendnek óránkénti ÉS napi korlátja
  // van — az „legfeljebb egy órát" a napi korlátnál hamis ígéret volt.
  PAYMENT_RETRY_LIMIT: {
    cim: 'Túl sok fizetési kísérlet',
    szoveg: 'Túl sok fizetést indítottál ennél a fuvarnál. Próbáld újra később (akár csak holnap). Ha elakadtál, írj nekünk: info@gofuvar.hu.',
    teendo: null,
  },
  // 2026-10-03 (CIB PR-5, C2): az új kártyás fizetések szüneteltetése
  // (CIB_UJ_FIZETES_TILTVA) — a már elindított kísérleteket a backend lezárja.
  CIB_PAUSED: {
    cim: 'A kártyás fizetés átmenetileg szünetel',
    szoveg: 'A kártyás fizetés átmenetileg szünetel: új fizetés most nem indítható, nem történt terhelés. A már elindított fizetéseket lezárjuk. Próbáld újra később; ha sürgős, írj nekünk: info@gofuvar.hu.',
    teendo: 'allapot',
  },
  CIB_INIT_FAILED: {
    cim: 'A bank nem érhető el',
    szoveg: 'A bank most nem érhető el, nem történt terhelés. Próbáld újra pár perc múlva.',
    teendo: null,
  },
  PAYMENT_START_FAILED: {
    cim: 'A fizetés nem indult el',
    szoveg: 'A díjfizetés indítása sikertelen, nem történt terhelés. Próbáld újra néhány perc múlva.',
    teendo: null,
  },
  CIB_BUSY: {
    cim: 'A bank most túlterhelt',
    szoveg: 'A bank most túl sok kérést kap, nem történt terhelés. Próbáld újra egy-két perc múlva.',
    teendo: null,
  },
  CIB_UNAVAILABLE: {
    cim: 'A kártyás fizetés átmenetileg szünetel',
    szoveg: 'A kártyás fizetés átmenetileg nem érhető el, nem történt terhelés. Próbáld újra később; ha sürgős, írj nekünk: info@gofuvar.hu.',
    teendo: null,
  },
  PAYMENT_TEMPORARILY_UNAVAILABLE: {
    cim: 'A fizetés átmenetileg nem indítható',
    szoveg: 'A fizetés most átmenetileg nem indítható, nem történt terhelés. Próbáld újra pár perc múlva.',
    teendo: null,
  },
  CONSENT_REQUIRED: {
    cim: 'Nyilatkozat szükséges',
    szoveg: 'A fizetéshez pipáld ki az azonnali teljesítésre vonatkozó nyilatkozatot.',
    teendo: null,
  },
  // 2026-10-01 (a CIB írásos válasza): a kártyás úton a CIB felé történő
  // adattovábbítási nyilatkozat is kötelező — a backend szövegével azonos.
  // Az állapotot újraolvassuk (a PR-4 1. javítóköre): ha a fee-payment hibája
  // miatt a kártya stub-felületet mutatott, a /pay viszont CIB-úton futott,
  // így jelenik meg a kért második jelölőnégyzet — különben zsákutca.
  CIB_CONSENT_REQUIRED: {
    cim: 'Adattovábbítási nyilatkozat szükséges',
    szoveg: 'A bankkártyás fizetéshez el kell fogadnod a CIB Bank felé történő adattovábbításról szóló nyilatkozatot.',
    teendo: 'allapot',
  },
};

const IDOTULLEPES: HibaUzenet = {
  cim: 'Nem indult el a fizetés',
  szoveg: 'Nem sikerült elindítani, nem történt terhelés. Próbáld újra.',
  teendo: 'allapot',
};

const HALOZAT: HibaUzenet = {
  cim: 'Nincs kapcsolat',
  szoveg: 'Nem sikerült elérni a szervert, nem történt terhelés. Ellenőrizd az internetkapcsolatod, és próbáld újra.',
  teendo: null,
};

const ALTALANOS: HibaUzenet = {
  cim: 'A fizetés nem indult el',
  szoveg: 'A fizetés indítása nem sikerült, nem történt terhelés. Próbáld újra pár perc múlva; ha ismétlődik, írj nekünk: info@gofuvar.hu.',
  teendo: 'fuvar',
};

// A kód NÉLKÜLI /pay-válaszok (2026-10-03, CIB PR-5): a fuvar-állapot kapui
// (nem elfogadott / már fizetett: 409), a nem-feladó (403), a hiányzó fuvar
// (404) és az általános írási fék (429) eddig a „próbáld újra pár perc múlva"
// szöveget kapta — ami egy már rendezett díjnál félrevezető.
const STATUSZ_SZERINT: Record<number, HibaUzenet> = {
  409: {
    cim: 'Megváltozott a fuvar állapota',
    szoveg: 'A díj ennél a fuvarnál most nem fizethető (például már rendezted, vagy a fuvar állapota megváltozott). Frissítettük az oldalt.',
    teendo: 'fuvar',
  },
  403: {
    cim: 'Ezt a díjat nem te fizeted',
    szoveg: 'A kapcsolatfelvételi díjat csak a fuvar feladója fizetheti ki. Nem történt terhelés.',
    teendo: null,
  },
  404: {
    cim: 'A fuvar nem található',
    szoveg: 'Ezt a fuvart nem találjuk (lehet, hogy közben törölték). Nem történt terhelés.',
    teendo: 'fuvar',
  },
  429: {
    cim: 'Túl sok kérés',
    szoveg: 'Rövid időn belül túl sok kérés érkezett. Várj egy percet, majd próbáld újra — nem történt terhelés.',
    teendo: null,
  },
};

/** Egy /pay-hiba → FIX szöveg. A szerver üzenete szándékosan SOHA nem jut át. */
export function fizetesHibaUzenet(err: { code?: string; status?: number; message?: string } | null | undefined): HibaUzenet {
  const code = err?.code;
  if (code && FIX[code]) return FIX[code];
  if (err?.message === IDOTULLEPES_UZENET) return IDOTULLEPES;
  if (err?.message === HALOZATI_HIBA_UZENET) return HALOZAT;
  if (!code && typeof err?.status === 'number' && STATUSZ_SZERINT[err.status]) return STATUSZ_SZERINT[err.status];
  return ALTALANOS;
}

// ── Eredményoldal ──────────────────────────────────────────────────────

export const GYORS_LEKERDEZES_MS = 3_000;
export const LASSU_LEKERDEZES_MS = 20_000;
/** Ennyi ideig kérdezünk 3 mp-enként; utána 20 mp-enként (a „Még tart" üzenettel). */
export const GYORS_SZAKASZ_MS = 180_000;

export function kovetkezoLekeresMs(elteltMs: number): number {
  return elteltMs < GYORS_SZAKASZ_MS ? GYORS_LEKERDEZES_MS : LASSU_LEKERDEZES_MS;
}

/**
 * Az automatikus lekérdezés felső korlátja: egy nyitva hagyott fül ne
 * kérdezzen a token 24 órás lejáratáig. Utána az oldal „Frissítés" gombot
 * ad (az eredményről e-mail is megy).
 */
export const LEKERDEZES_PLAFON_MS = 30 * 60_000;

export function lekerdezesFolytathato(elteltMs: number): boolean {
  return elteltMs < LEKERDEZES_PLAFON_MS;
}

/** Ennyi egymást követő (nem 404-es) hiba után mondjuk ki, hogy most nem érjük el. */
export const ELERHETETLEN_HIBASZAM = 3;

/**
 * A díjfizetési állapot (GET /jobs/:id/fee-payment) átmeneti hibájánál ennyi
 * várakozás után próbáljuk újra — különben CIB-módban egyetlen elbukott
 * kérés a stub-felületet hagyná ott (a banki kötelező blokk nélkül).
 */
export const ALLAPOT_UJRAPROBA_MS = [2_000, 5_000, 15_000] as const;

/** Átmeneti-e a hiba (újrapróbálandó)? A 401/403/404 és a programhiba nem az. */
export function atmenetiHiba(err: unknown): boolean {
  const e = (err || {}) as { status?: number; message?: string };
  if (typeof e.status === 'number') return e.status === 429 || e.status >= 500;
  return e.message === IDOTULLEPES_UZENET || e.message === HALOZATI_HIBA_UZENET;
}

/** A 429 utáni várakozás felső korlátja (egy hibás fejléc se állítsa le a lekérdezést). */
export const MAX_429_VARAKOZAS_MS = 120_000;

/**
 * A következő lekérdezésig várandó idő egy hiba után. 2026-10-03 (CIB PR-5,
 * lelet 11): 429-re eddig is 3 mp-enként kérdeztünk tovább — közös NAT/CGNAT
 * mögött ez fogyasztotta el a banki visszatérés keretét. 429-nél a szerver
 * kérte ideig (`retryAfterMs`), ennek híján a lassú ütemig várunk; más hibánál
 * az alapütem marad.
 */
export function varakozasHibaUtan(err: unknown, alapMs: number): number {
  const e = (err || {}) as { status?: number; retryAfterMs?: number };
  if (e.status !== 429) return alapMs;
  const kert = typeof e.retryAfterMs === 'number' && Number.isFinite(e.retryAfterMs) ? e.retryAfterMs : LASSU_LEKERDEZES_MS;
  return Math.min(Math.max(alapMs, kert), MAX_429_VARAKOZAS_MS);
}

/** Csak a „feldolgozas" nem végleges — minden más állapotnál a lekérdezés leáll. */
export function vegleges(allapot: string | null | undefined): boolean {
  return !!allapot && allapot !== 'feldolgozas';
}

/**
 * Az eredményoldal következő lekérdezéséig várandó idő az állapot szerint;
 * null: a lekérdezés leáll. Ismeretlen állapotnál (még nincs válasz) a
 * megszokott ütem. 2026-10-04 (W2): az egyeztetés alatti („ellenorzes")
 * kísérletet a backend magától rendezi (a MSGT10 után CIB_EGYEZTETES_PERC,
 * alapból 20 perccel csak-olvasó MSGT33) — eddig itt leállt a lekérdezés, és a
 * kijelentkezett (socket nélküli) böngészőben a döntés soha nem jelent meg.
 * Lassú ütemben figyelünk, a 30 perces plafonig.
 */
export function lekerdezesUtem(allapot: string | null | undefined, elteltMs: number): number | null {
  if (allapot === 'ellenorzes') return LASSU_LEKERDEZES_MS;
  if (allapot && vegleges(allapot)) return null;
  return kovetkezoLekeresMs(elteltMs);
}

// ── Segédek ────────────────────────────────────────────────────────────

/** „3 perce" / „néhány másodperce" a sárga sávhoz. */
export function percKiiras(iso: string | null | undefined, most = Date.now()): string {
  const t = iso ? Date.parse(iso) : NaN;
  if (!Number.isFinite(t)) return 'nemrég';
  const perc = Math.floor((most - t) / 60_000);
  if (perc < 1) return 'néhány másodperce';
  if (perc < 120) return `${perc} perce`;
  const ora = Math.floor(perc / 60);
  return `${ora} órája`;
}

/** Csak http(s) célra irányítunk (a `javascript:`/`data:` URL soha). */
export function biztonsagosAtiranyitasiCel(url: string | null | undefined): url is string {
  return typeof url === 'string' && /^https?:\/\/[^\s]+$/i.test(url.trim());
}
