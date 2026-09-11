// Felvételi időablak (2026-09-11, teljes audit B3): a backend eddig is
// fogadta a pickup_window_start/end mezőket, a feladási űrlapon viszont
// nem voltak — a szállító nem tudta, mikor lehet menni. Kliens-oldali
// szabályok (a backend a dátum-alakot és a sorrendet külön is ellenőrzi).
const ORA = 60 * 60 * 1000;

export function idoablakHiba(start: string, end: string, most = Date.now()): string | null {
  if (!start && !end) return null;
  const s = start ? new Date(start).getTime() : null;
  const e = end ? new Date(end).getTime() : null;
  if (start && Number.isNaN(s)) return 'Érvénytelen kezdő időpont.';
  if (end && Number.isNaN(e)) return 'Érvénytelen záró időpont.';
  if (s != null && s < most - ORA) return 'A felvételi időablak kezdete nem lehet a múltban.';
  if (e != null && s == null && e < most) return 'Az időablak vége nem lehet a múltban.';
  if (s != null && e != null && e < s) return 'Az időablak vége nem lehet a kezdete előtt.';
  const utolso = e ?? s;
  if (utolso != null && utolso > most + 60 * 24 * ORA) return 'Legfeljebb 60 nappal előre adható meg.';
  return null;
}

/** „szept. 12. 10:00 – 14:00" / „szept. 12. 10:00-tól" / „szept. 12. 14:00-ig" */
export function idoablakSzoveg(start?: string | null, end?: string | null): string | null {
  if (!start && !end) return null;
  const f = (v: string) => new Date(v).toLocaleString('hu-HU', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
  if (start && end) {
    const s = new Date(start); const e = new Date(end);
    const ugyanaznap = s.toDateString() === e.toDateString();
    return `${f(start)} – ${ugyanaznap ? e.toLocaleTimeString('hu-HU', { hour: '2-digit', minute: '2-digit' }) : f(end)}`;
  }
  if (start) return `${f(start)}-tól`;
  return `${f(end!)}-ig`;
}
