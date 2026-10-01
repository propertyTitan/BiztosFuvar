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
  /** Egy kísérlet feldolgozása / lezárása fut — a gomb rejtve, 5 mp-es frissítés. */
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
const SIKERTELEN = new Set(['sikertelen', 'nem_terhelt', 'mar_fizetve', 'failed', 'expired', 'not_closed', 'abandoned', 'init_failed']);

export function kartyaAllapot(fp: FeePaymentAllapot | null | undefined): KartyaAllapot {
  if (!fp || fp.provider_kind !== 'cib') return 'alap';
  const oa = fp.open_attempt;
  if (oa) {
    const a = String(oa.allapot || '');
    if (ELLENORZES.has(a)) return 'ellenorzes';
    if (SIKERES.has(a)) return 'sikeres';
    if (LEZARAS.has(a)) return 'lezaras';
    // A „feldolgozas" a bankhoz ment, vissza nem tért kísérletet ÉS a lezárás
    // alattit is jelentheti: a `can_pay` dönt (a redirected nem blokkolja az
    // új fizetést, a zárás igen — lásd a terv „Mit blokkol" táblázatát).
    // ⚠️ A can_pay=false egy másik fülben ÉPP INDULÓ kísérletet is jelenthet,
    // ezért a lezárás-doboz szövege semleges (nem állít banki jóváhagyást).
    // Az open_attempt.allapot pontos értékkészletét a CIB-mag PR-rel kell
    // egyeztetni (a szerződés csak az eredményoldal szótárát rögzíti).
    if (a === 'feldolgozas') return fp.can_pay === false ? 'lezaras' : 'nyitott';
    return 'nyitott';
  }
  const lr = fp.last_result;
  if (lr) {
    const a = String(lr.allapot || '');
    if (ELLENORZES.has(a)) return 'ellenorzes';
    if (SIKERES.has(a)) return 'sikeres';
    if (LEZARAS.has(a)) return 'lezaras';
    if (a === 'feldolgozas') return fp.can_pay === false ? 'lezaras' : 'nyitott';
    if (SIKERTELEN.has(a)) return 'elozo_sikertelen';
  }
  return 'alap';
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
  PAYMENT_RETRY_LIMIT: {
    cim: 'Túl sok fizetési kísérlet',
    szoveg: 'Rövid időn belül túl sok fizetést indítottál. Várj egy kicsit (legfeljebb egy órát), majd próbáld újra. Ha elakadtál, írj nekünk: info@gofuvar.hu.',
    teendo: null,
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
  CIB_CONSENT_REQUIRED: {
    cim: 'Adattovábbítási nyilatkozat szükséges',
    szoveg: 'A bankkártyás fizetéshez el kell fogadnod a CIB Bank felé történő adattovábbításról szóló nyilatkozatot.',
    teendo: null,
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

/** Egy /pay-hiba → FIX szöveg. A szerver üzenete szándékosan SOHA nem jut át. */
export function fizetesHibaUzenet(err: { code?: string; status?: number; message?: string } | null | undefined): HibaUzenet {
  const code = err?.code;
  if (code && FIX[code]) return FIX[code];
  if (err?.message === IDOTULLEPES_UZENET) return IDOTULLEPES;
  if (err?.message === HALOZATI_HIBA_UZENET) return HALOZAT;
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

/** Csak a „feldolgozas" nem végleges — minden más állapotnál a lekérdezés leáll. */
export function vegleges(allapot: string | null | undefined): boolean {
  return !!allapot && allapot !== 'feldolgozas';
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
