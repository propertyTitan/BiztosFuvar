// =====================================================================
//  Értesítés-lista segédek (2026-10-08, UX-átvizsgálás A22)
//
//  A címek emojival kezdődtek („🎉 Megállapodás!"), az ikon a típusból
//  jön (lucide — CLAUDE.md design-szabály: UI-ikon emoji TILOS). A régi,
//  már tárolt értesítések címét a megjelenítéskor tisztítjuk; az új
//  szövegeket a backend küldi.
// =====================================================================

/** Ikoncsalád az értesítés típusa szerint (a lap képezi lucide ikonra). */
export type ErtesitesIkon =
  | 'ajanlat' | 'megallapodas' | 'fizetes' | 'uton' | 'kezbesitve' | 'uzenet'
  | 'ertekeles' | 'vita' | 'lemondas' | 'figyelmeztetes' | 'admin' | 'altalanos';

const TIPUS_IKON: Array<[RegExp, ErtesitesIkon]> = [
  [/^(bid_received|counter_offer|bid_withdrawn|no_offer_nudge|lane_alert|backhaul_match|instant_job_nearby|job_question|job_question_answered|job_updated)$/, 'ajanlat'],
  [/^(bid_accepted|deal_closed|counter_accepted|booking_confirmed|instant_accepted|booking_received)$/, 'megallapodas'],
  [/^(payment_|job_paid|booking_paid|refund_issued|cib)/, 'fizetes'],
  [/^(job_picked_up|booking_picked_up|driver_nearby|driver_entering_city)$/, 'uton'],
  [/^(job_delivered|booking_delivered)$/, 'kezbesitve'],
  [/^(chat_message)$/, 'uzenet'],
  [/^(review_received|badge_earned|level_up|referral_reward)$/, 'ertekeles'],
  [/^(dispute_|admin_dispute_opened)/, 'vita'],
  [/^(job_cancelled|booking_cancelled|booking_rejected|instant_expired|job_reopened)$/, 'lemondas'],
  [/^(sos_|security|kyc_|tax_data_)/, 'figyelmeztetes'],
  [/^(admin_)/, 'admin'],
];

export function ertesitesIkon(tipus: string | null | undefined): ErtesitesIkon {
  const t = String(tipus || '');
  for (const [minta, ikon] of TIPUS_IKON) if (minta.test(t)) return ikon;
  return 'altalanos';
}

// Kezdő piktogram(ok) + változat-jelölők + szóköz — a szöveg többi része marad.
const KEZDO_EMOJI = /^(?:[\p{Extended_Pictographic}\p{Regional_Indicator}\u{FE0F}\u{200D}\u{20E3}]+\s*)+/u;
// A záró piktogram is (pl. „Új ajánlat érkezett 🎯").
const ZARO_EMOJI = /(?:\s*[\p{Extended_Pictographic}\u{FE0F}\u{200D}]+)+$/u;

/** A cím a dekoratív emoji nélkül (az ikont a típus adja). */
export function cimEmojiNelkul(cim: string | null | undefined): string {
  const s = String(cim ?? '').replace(KEZDO_EMOJI, '').replace(ZARO_EMOJI, '').trim();
  return s || String(cim ?? '').trim();
}

/**
 * Az értesítés a MOST nyitott oldalra szól-e (UX A14)? Akkor nem kell
 * toast: a fuvaroldal élőben frissül, a toast csak a következő lépést
 * (a díjkártyát) takarná. A query és a horgony nem számít; a záró
 * perjel sem.
 */
export function ertesitesErreAzOldalraSzol(
  link: string | null | undefined,
  pathname: string | null | undefined,
): boolean {
  if (!link || !pathname || !link.startsWith('/')) return false;
  const tisztit = (s: string) => s.split(/[?#]/)[0].replace(/\/+$/, '') || '/';
  return tisztit(link) === tisztit(pathname);
}
