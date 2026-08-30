// =====================================================================
//  Űrlap-validáció — közös szabályok a feladói űrlapokhoz
//
//  2026-08-04, tesztelői észrevétel: a fuvar-feladásnál a szám-mezők
//  elfogadtak negatív és tört értéket, és a hiányzó mezőnél nem volt
//  magyarázat. Itt egy helyen van, mit fogadunk el — így a beviteli
//  szűrés (sanitize*) és a hibaüzenet (…Error) sosem csúszhat szét,
//  és unit-teszttel őrizhető.
//
//  A felső korlátok a backend `POST /jobs` ellenőrzéseinek tükre
//  (backend/src/routes/jobs.js) — ha ott változik, itt is módosítsd.
// =====================================================================

/** Csomag-oldal maximuma cm-ben (efölött a DB NUMERIC(8,2) túlcsordulna). */
export const MAX_DIM_CM = 2000;
/** Csomagsúly maximuma kg-ban. */
export const MAX_WEIGHT_KG = 100000;
/** Pénz-mezők (fuvardíj, csomagérték) felső korlátja forintban. */
export const MAX_HUF = 100000000;

/**
 * Szám-mező beviteli szűrése: számjegyek + EGY tizedes elválasztó.
 * A magyar vesszőt pontra cseréli, a mínuszjelet és minden más karaktert
 * eldob — negatív érték így BE SEM ÍRHATÓ.
 *
 * A tizedespontot egész mezőknél is ÁTENGEDJÜK, és a hibaüzenet szól érte
 * (`intFieldError`). Ha némán kidobnánk, a „12,5" 125-té válna — egy
 * tizedes nagyságrenddel elhibázott méret sokkal rosszabb, mint egy
 * látható hibaüzenet.
 */
export function sanitizeNumericInput(raw: string): string {
  const cleaned = raw.replace(',', '.').replace(/[^0-9.]/g, '');
  const firstDot = cleaned.indexOf('.');
  if (firstDot === -1) return cleaned;
  // a további pontokat eldobjuk (pl. "1.2.3" → "1.23")
  return cleaned.slice(0, firstDot + 1) + cleaned.slice(firstDot + 1).replace(/\./g, '');
}

/**
 * Nyers beviteli szövegből szám (vagy '' ha még nincs értelmes érték).
 * A „12." köztes gépelési állapot 12-t ad, de a nyers szöveget a mező
 * megtartja — így a tizedes beírása nem szakad félbe.
 */
export function parseNumericInput(raw: string): number | '' {
  if (raw === '' || raw === '.') return '';
  const n = Number(raw);
  return Number.isFinite(n) ? n : '';
}

type NumOpts = { label: string; max: number; min?: number };

/**
 * Egész, pozitív mező (csomagméret cm). Visszaad egy magyar hibaüzenetet,
 * vagy null-t, ha rendben van. Üres érték = "kérjük töltsd ki".
 */
export function intFieldError(value: number | '', opts: NumOpts): string | null {
  const { label, max, min = 1 } = opts;
  if (value === '' || value === null || Number.isNaN(value)) {
    return `Kérjük, töltsd ki: ${label}.`;
  }
  const n = Number(value);
  if (!Number.isFinite(n)) return `${label}: csak számot adhatsz meg.`;
  if (n < 0) return `${label}: negatív érték nem adható meg.`;
  if (!Number.isInteger(n)) return `${label}: egész számot adj meg (tört érték nem adható meg).`;
  if (n < min) return `${label}: legalább ${min} legyen.`;
  if (n > max) return `${label}: legfeljebb ${max.toLocaleString('hu-HU')} lehet.`;
  return null;
}

/**
 * Súly: pozitív, tört megengedett (0,1 kg pontosság), de negatív nem.
 */
export function weightFieldError(value: number | ''): string | null {
  if (value === '' || value === null || Number.isNaN(value)) {
    return 'Kérjük, töltsd ki: Súly (kg).';
  }
  const n = Number(value);
  if (!Number.isFinite(n)) return 'Súly: csak számot adhatsz meg.';
  if (n < 0) return 'Súly: negatív érték nem adható meg.';
  if (n <= 0) return 'Súly: 0-nál nagyobb értéket adj meg.';
  if (n > MAX_WEIGHT_KG) {
    return `Súly: legfeljebb ${MAX_WEIGHT_KG.toLocaleString('hu-HU')} kg lehet.`;
  }
  return null;
}

/**
 * Pénz-mező (Ft): egész, nem negatív. `required=false` esetén az üres érték OK
 * (pl. csomagérték), `min` a legkisebb elfogadott összeg.
 */
export function moneyFieldError(
  value: number | '',
  opts: { label: string; required?: boolean; min?: number },
): string | null {
  const { label, required = true, min = 1 } = opts;
  if (value === '' || value === null || Number.isNaN(value)) {
    return required ? `Kérjük, töltsd ki: ${label}.` : null;
  }
  const n = Number(value);
  if (!Number.isFinite(n)) return `${label}: csak számot adhatsz meg.`;
  if (n < 0) return `${label}: negatív összeg nem adható meg.`;
  if (!Number.isInteger(n)) return `${label}: kerek forintösszeget adj meg (fillér nincs).`;
  if (n < min) return `${label}: legalább ${min.toLocaleString('hu-HU')} Ft legyen.`;
  if (n > MAX_HUF) return `${label}: legfeljebb ${MAX_HUF.toLocaleString('hu-HU')} Ft lehet.`;
  return null;
}

/**
 * Telefonszám (címzett). Szándékosan megengedő: elfogad magyar és nemzetközi
 * formát, szóközzel / kötőjellel / zárójellel tagolva — csak azt kötjük ki,
 * hogy legyen benne értelmes mennyiségű számjegy. A cél nem a formátum-
 * rendőrség, hanem hogy a szállító tudja hívni a címzettet.
 */
/**
 * Opcionális e-mail mező hibája (GF-005, Manus 2026-08-30): üresen érvényes,
 * de ha ki van töltve, szintaktikailag helyesnek kell lennie — a címzett-
 * e-mailre követési linket ígérünk, hibás címre a levél némán elveszne.
 * Ugyanaz a minta, mint a backend regisztrációs ellenőrzése (auth.js).
 */
export function emailError(raw: string): string | null {
  const trimmed = (raw || '').trim();
  if (!trimmed) return null;
  if (trimmed.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(trimmed)) {
    return 'Az e-mail cím érvénytelen (pl. nev@email.hu) — javítsd, vagy hagyd üresen.';
  }
  return null;
}

// ── Profil-űrlap validátorok (GF-012/015, Manus 2026-08-30) ─────────────
// A PATCH /auth/me szerver-szabályainak KLIENS-oldali tükrei — a mentés
// eddig csak toastban közölte az okot, mezőszintű jelzés nélkül.

/** Teljes név: 2–100 karakter, nem állhat csak szóközből (backend-szabály). */
export function nameError(raw: string): string | null {
  const trimmed = (raw || '').trim();
  if (trimmed.length < 2) return 'A név legalább 2 karakter — nem állhat üresen vagy csak szóközből.';
  if (trimmed.length > 100) return 'A név legfeljebb 100 karakter lehet.';
  return null;
}

/**
 * Opcionális telefonszám (profil): üresen érvényes; kitöltve 6–15 számjegy
 * (a PATCH /auth/me szabálya — a címzett-telefon 9-es minimuma ott marad).
 */
export function optionalPhoneError(raw: string): string | null {
  const trimmed = (raw || '').trim();
  if (!trimmed) return null;
  if (/[a-zA-Z]/.test(trimmed)) {
    return 'A telefonszám csak számokat tartalmazhat (+, szóköz, kötőjel megengedett).';
  }
  const digits = trimmed.replace(/\D/g, '');
  if (digits.length < 6 || digits.length > 15) {
    return 'Érvénytelen telefonszám — 6–15 számjegy, pl. +36 20 123 4567.';
  }
  return null;
}

/** Rendszám: üresen érvényes; kitöltve 2–12 karakter, betű/szám/kötőjel. */
export function plateError(raw: string): string | null {
  const trimmed = (raw || '').trim();
  if (!trimmed) return null;
  if (!/^[A-Za-z0-9-]{2,12}$/.test(trimmed)) {
    return 'Érvénytelen rendszám — 2–12 karakter, csak betű, szám és kötőjel.';
  }
  return null;
}

/** Bemutatkozás: legfeljebb 1000 karakter (backend-szabály). */
export function bioError(raw: string): string | null {
  if ((raw || '').length > 1000) return 'A bemutatkozás legfeljebb 1000 karakter lehet.';
  return null;
}

export function phoneError(raw: string): string | null {
  const trimmed = (raw || '').trim();
  if (!trimmed) return 'Kérjük, töltsd ki: Címzett telefonszáma.';
  if (/[a-zA-Z]/.test(trimmed)) {
    return 'A telefonszám csak számokat tartalmazhat (+, szóköz, kötőjel megengedett).';
  }
  const digits = trimmed.replace(/\D/g, '');
  if (digits.length < 9) return 'A telefonszám túl rövid — add meg a körzetszámmal együtt (pl. +36 30 123 4567).';
  if (digits.length > 15) return 'A telefonszám túl hosszú.';
  return null;
}
