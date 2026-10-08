// =====================================================================
//  Időpont-szövegek — budapesti idő szerint, determinisztikusan
//  (2026-10-08, UX-átvizsgálás A1, A22, Q6)
//
//  A felületen eddig a böngésző `toLocaleString('hu-HU')`-ja szólt
//  („2026. 10. 08. 10:53:45"): másodpercre pontos, nem tördelődő, mobilon
//  a hely 40%-át elvitte. Itt rövid, emberi alakok készülnek:
//   - rovidDatumIdo: „okt. 8., 10:52"
//   - relativIdo:    „most" / „12 perce" / „3 órája" / „tegnap 14:20" /
//                    „okt. 8., 10:52"
//   - felvetelIdopont: az ajánlat érkezési ideje abszolút időpontként
//     („Várható felvétel: kb. okt. 8., 15:40"), mert a „~300 perc" az ajánlat-
//     tételhez viszonyít — egy nappal később olvasva értelmetlen.
//  A számításhoz a budapesti naptári részeket az Intl adja (a felhasználó
//  gépének időzónájától függetlenül), a hónapnevek rögzítettek.
// =====================================================================

const HONAPOK = ['jan.', 'febr.', 'márc.', 'ápr.', 'máj.', 'jún.', 'júl.', 'aug.', 'szept.', 'okt.', 'nov.', 'dec.'];

type Reszek = { ev: number; ho: number; nap: number; ora: number; perc: number };

const FORMAZO = new Intl.DateTimeFormat('en-GB', {
  timeZone: 'Europe/Budapest',
  year: 'numeric', month: 'numeric', day: 'numeric',
  hour: 'numeric', minute: 'numeric', hourCycle: 'h23',
});

function ervenyes(d: Date | string | number | null | undefined): Date | null {
  if (d === null || d === undefined || d === '') return null;
  const x = d instanceof Date ? d : new Date(d);
  return Number.isFinite(x.getTime()) ? x : null;
}

/** A dátum budapesti naptári részei. */
export function budapestiReszek(d: Date): Reszek {
  const r: Record<string, number> = {};
  for (const p of FORMAZO.formatToParts(d)) {
    if (p.type !== 'literal') r[p.type] = Number(p.value);
  }
  return { ev: r.year, ho: r.month, nap: r.day, ora: r.hour % 24, perc: r.minute };
}

const ketJegy = (n: number) => String(n).padStart(2, '0');

/** „okt. 8., 10:52" — érvénytelen bemenetre üres szöveg. */
export function rovidDatumIdo(d: Date | string | number | null | undefined): string {
  const x = ervenyes(d);
  if (!x) return '';
  const r = budapestiReszek(x);
  return `${HONAPOK[r.ho - 1]} ${r.nap}., ${ketJegy(r.ora)}:${ketJegy(r.perc)}`;
}

/** Teljes, olvasható időpont a `<time title>`-hoz: „2026. okt. 8., 10:52". */
export function teljesDatumIdo(d: Date | string | number | null | undefined): string {
  const x = ervenyes(d);
  if (!x) return '';
  return `${budapestiReszek(x).ev}. ${rovidDatumIdo(x)}`;
}

function napSorszam(r: Reszek): number {
  return Math.floor(Date.UTC(r.ev, r.ho - 1, r.nap) / 86_400_000);
}

/**
 * Relatív idő az értesítésekhez: „most", „12 perce", „3 órája",
 * „tegnap 14:20", egyébként „okt. 8., 10:52". Jövőbeli (óraeltérés)
 * időpontra „most".
 */
export function relativIdo(d: Date | string | number | null | undefined, most: Date = new Date()): string {
  const x = ervenyes(d);
  if (!x) return '';
  const percek = Math.floor((most.getTime() - x.getTime()) / 60_000);
  if (percek < 1) return 'most';
  if (percek < 60) return `${percek} perce`;
  const rx = budapestiReszek(x);
  const rm = budapestiReszek(most);
  const napKulonbseg = napSorszam(rm) - napSorszam(rx);
  if (napKulonbseg === 0) return `${Math.floor(percek / 60)} órája`;
  if (napKulonbseg === 1) return `tegnap ${ketJegy(rx.ora)}:${ketJegy(rx.perc)}`;
  return rovidDatumIdo(x);
}

/**
 * Az ajánlat felvételi időpontja: ajánlattétel + a szállító által vállalt
 * „érkezés a felvételre" percek. Visszaad: „kb. okt. 8., 15:40", és ha
 * 24 órán belül jövőbeli, a relatív alakot is („kb. 5 óra múlva").
 * Hiányzó / érvénytelen adatra null.
 */
export function felvetelIdopont(
  ajanlatIdeje: string | null | undefined,
  etaPerc: number | null | undefined,
  most: Date = new Date(),
): { abszolut: string; relativ: string | null; elmult: boolean } | null {
  const kezdet = ervenyes(ajanlatIdeje);
  const perc = Number(etaPerc);
  if (!kezdet || !Number.isFinite(perc) || perc <= 0) return null;
  const cel = new Date(kezdet.getTime() + perc * 60_000);
  const hatra = Math.round((cel.getTime() - most.getTime()) / 60_000);
  let relativ: string | null = null;
  if (hatra > 0 && hatra < 24 * 60) {
    relativ = hatra < 60 ? `kb. ${hatra} perc múlva` : `kb. ${Math.round(hatra / 60)} óra múlva`;
  }
  // Rag nélkül: a „-tól/-től" a kiejtett számtól függ (15:30-tól, 15:40-től).
  // `elmult`: egy napokkal korábbi ajánlatnál a „Várható felvétel" félrevezető
  // lenne — a hívó ilyenkor másként fogalmaz (fix2-review).
  return { abszolut: `kb. ${rovidDatumIdo(cel)}`, relativ, elmult: hatra <= 0 };
}
