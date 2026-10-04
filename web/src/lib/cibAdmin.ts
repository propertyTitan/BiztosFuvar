// =====================================================================
//  CIB admin — a kézi műveletek, a rendezés mezői és a lista szűrője
//  (CIB PR-5, web W2 — 2026-10-04)
//
//  A backend (cib-pr5/backend) szabályainak webes tükre, komponens nélkül
//  mérhetően. Forrás: backend/src/services/cibFizetes.js (keziRendezes,
//  rendezes) és backend/src/routes/cibFizetes.js (GET /payments/admin/cib).
//  A backend a döntő — a web csak azt nem küldi el, amit úgyis visszadobna,
//  és csak ott kínál műveletet, ahol a backend engedi.
// =====================================================================

export type KeziMuvelet = 'konyveles' | 'lejaratas' | 'visszaterites';

/** A backend LEJARATHATO listája: a zárási határidő után lejáratható nem végső állapotok. */
export const LEJARATHATO_ALLAPOTOK = ['initializing', 'ready', 'redirected', 'authorized', 'closing'] as const;

/**
 * A konfig nélkül is elérhető kézi műveletek, amelyeket a backend az adott
 * munkamenet-állapotban elfogad (POST /payments/admin/cib/:trid/kezi-rendezes):
 *   konyveles     — függő (pending) + closed_ok: a bank lezárta, a könyvelés nem futott le;
 *   lejaratas     — függő + initializing/ready/redirected/authorized/closing;
 *   visszaterites — needs_review + closed_ok (könyvelési árva).
 * A kétes (close_unknown) kísérlet a „Lezárva / Nem lezárva" rendezésé.
 */
export function keziMuveletek(s: { state?: unknown; cib_state?: unknown } | null | undefined): KeziMuvelet[] {
  if (!s) return [];
  const { state, cib_state: cs } = s;
  if (state === 'pending' && cs === 'closed_ok') return ['konyveles'];
  if (state === 'pending' && (LEJARATHATO_ALLAPOTOK as readonly unknown[]).includes(cs)) return ['lejaratas'];
  if (state === 'needs_review' && cs === 'closed_ok') return ['visszaterites'];
  return [];
}

export const INDOKLAS_MIN = 10;
export const INDOKLAS_MAX = 2000;
export const BANKI_HIVATKOZAS_MAX = 100;
const BANKI_HIVATKOZAS_MINTA = /^[A-Za-z0-9 ./_-]{1,100}$/;
/** A backend RT-plafonja a „lezarva" rendezésnél (C6). */
export const RT_MAX = 255;
// A backend a vezérlőkaraktert (U+0000–U+001F, U+007F) utasítja el az RT-ben.
// eslint-disable-next-line no-control-regex
const VEZERLO = /[\u0000-\u001f\u007f]/;

/** Az indoklás (a backend a szóközök levágása után méri): 10–2000 karakter. */
export function indoklasHiba(v: string | null | undefined): string | null {
  const n = (v || '').trim().length;
  if (n < INDOKLAS_MIN) return `Az indoklás legalább ${INDOKLAS_MIN} karakter legyen (a bankkal való egyeztetés lényege).`;
  if (n > INDOKLAS_MAX) return `Az indoklás legfeljebb ${INDOKLAS_MAX} karakter lehet.`;
  return null;
}

/** A banki hivatkozás opcionális; ha van: ≤100 karakter, betű, szám, szóköz, . / _ - */
export function bankiHivatkozasHiba(v: string | null | undefined): string | null {
  const t = (v || '').trim();
  if (!t) return null;
  if (!BANKI_HIVATKOZAS_MINTA.test(t)) {
    return `A banki hivatkozás legfeljebb ${BANKI_HIVATKOZAS_MAX} karakter: betű (ékezet nélkül), szám, szóköz, pont, perjel, aláhúzás vagy kötőjel.`;
  }
  return null;
}

/** Az RT opcionális (üresen a backend alapértéke: „Tranzakció elfogadva"); ≤255 karakter, vezérlőkarakter nélkül. */
export function rtHiba(v: string | null | undefined): string | null {
  const t = (v || '').trim();
  if (!t) return null;
  if (t.length > RT_MAX) return `Az RT legfeljebb ${RT_MAX} karakter lehet.`;
  if (VEZERLO.test(t)) return 'Az RT nem tartalmazhat sortörést vagy más vezérlőkaraktert.';
  return null;
}

export type AdminHiba = { cim: string; szoveg: string };

const ADMIN_HIBAK: Record<string, AdminHiba> = {
  STATE_CHANGED: {
    cim: 'A tétel állapota közben megváltozott',
    szoveg: 'A műveletet nem rögzítettük. Frissítettük a részleteket — nézd meg, kell-e még.',
  },
  CIB_ROW_BUSY: {
    cim: 'A tételen épp dolgozik a rendszer',
    szoveg: 'A műveletet nem rögzítettük. Próbáld újra egy perc múlva.',
  },
  CIB_DEADLINE_NOT_PASSED: {
    cim: 'A zárási határidő még nem járt le',
    szoveg: 'A bank még lezárhatja a tranzakciót (alapból a MSGT10 után 9 perc 30 mp-ig). A határidő után próbáld újra.',
  },
  CIB_CLOSE_NOT_SENT: {
    cim: 'Zárási kérés nem ment ki',
    szoveg: 'Ehhez a kísérlethez zárási kérés (MSGT32) nem ment ki — a bank nem terhelhetett, csak „Nem lezárva" rendezhető.',
  },
  CIB_UNAVAILABLE: {
    cim: 'A CIB-konfiguráció nem teljes',
    szoveg: 'Banki lekérdezés most nem indítható. A kézi műveletek (könyvelés, lejáratás, visszatérítés) konfiguráció nélkül is elérhetők.',
  },
  INVALID_VALUE: {
    cim: 'Hibás adat',
    szoveg: 'Ellenőrizd az indoklást (10–2000 karakter) és a kitöltött mezőket.',
  },
  NOT_FOUND: {
    cim: 'A tétel nem található',
    szoveg: 'Frissítsd a listát.',
  },
};

const ALTALANOS_HIBA: AdminHiba = { cim: 'A művelet nem sikerült', szoveg: 'Frissítsd a részleteket, és próbáld újra.' };

/**
 * Egy admin CIB-művelet hibája → FIX szöveg (a szerver szövegét itt sem
 * tesszük ki). Ismeretlen hibára az `alap` (a hívó saját általános szövege).
 */
export function adminMuveletHiba(err: unknown, alap: AdminHiba = ALTALANOS_HIBA): AdminHiba {
  const e = (err || {}) as { code?: string; status?: number };
  if (e.code && ADMIN_HIBAK[e.code]) return ADMIN_HIBAK[e.code];
  if (e.status === 404) return ADMIN_HIBAK.NOT_FOUND;
  return alap;
}

/** A hiba után a részleteket újra kell olvasni (a tétel állapota közben változott). */
export function allapotValtozott(err: unknown): boolean {
  const e = (err || {}) as { code?: string };
  return e.code === 'STATE_CHANGED';
}

/**
 * A lista állapot-szűrője — a backend szótára (GET /payments/admin/cib):
 * a „ellenorzes" (kétes + felülvizsgálandó), a „needs_review" és a nyers
 * CIB-állapotok. ⚠️ 2026-10-04: eddig a felület szótára ment („sikeres",
 * „sikertelen", „nem_terhelt"…), amit a backend 400-zal utasított el.
 */
export const ALLAPOT_SZURO: ReadonlyArray<{ ertek: string; nev: string }> = [
  { ertek: 'ellenorzes', nev: 'Egyeztetésre vár (kétes + felülvizsgálandó)' },
  { ertek: 'needs_review', nev: 'Felülvizsgálandó (könyvelési árva)' },
  { ertek: 'close_unknown', nev: 'Kétes lezárás (close_unknown)' },
  { ertek: 'initializing', nev: 'Indul (initializing)' },
  { ertek: 'ready', nev: 'Átirányításra kész (ready)' },
  { ertek: 'redirected', nev: 'A bank oldalán (redirected)' },
  { ertek: 'authorized', nev: 'Jóváhagyva, lezárásra vár (authorized)' },
  { ertek: 'closing', nev: 'Lezárás folyamatban (closing)' },
  { ertek: 'closed_ok', nev: 'Lezárva (closed_ok)' },
  { ertek: 'failed', nev: 'Elutasítva (failed)' },
  { ertek: 'expired', nev: 'Lejárt (expired)' },
  { ertek: 'not_closed', nev: 'Nem zártuk le (not_closed)' },
  { ertek: 'abandoned', nev: 'Félbehagyva (abandoned)' },
  { ertek: 'init_failed', nev: 'Indítás sikertelen (init_failed)' },
];
