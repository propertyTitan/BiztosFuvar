// A vendég piszkozata ugyanabban a böngészőfülben átvihető a belépésen.
// Belépett felhasználónál fiókhoz kötjük; kijelentkezéskor töröljük.
export const HOZASD_EL_DRAFT = 'gofuvar_hozasd_el';
export const HOZASD_EL_PREFILL = 'gofuvar_prefill';
const MAX_AGE = 24 * 60 * 60 * 1000;
const STORES = ['IKEA', 'OBI', 'Praktiker', 'Jófogás'];
const IMAGE_HOSTS = ['ikea.com', 'obi.hu', 'praktiker.hu', 'jofogas.hu'];

export type HozasdElAddress = { address: string; lat: number | null; lng: number | null; confirmed: boolean };
export type HozasdElDraft = {
  url: string; title: string; description: string; image: string; sourceName: string;
  ready: boolean; manual: boolean; pickup: HozasdElAddress; dropoff: HozasdElAddress;
};

export function emptyHozasdElDraft(): HozasdElDraft {
  return { url: '', title: '', description: '', image: '', sourceName: '', ready: false, manual: false,
    pickup: { address: '', lat: null, lng: null, confirmed: false },
    dropoff: { address: '', lat: null, lng: null, confirmed: false } };
}

export function safeProductImage(value: unknown): string {
  if (typeof value !== 'string' || value.length > 2048) return '';
  try {
    const u = new URL(value);
    return u.protocol === 'https:' && !u.username && !u.password
      && IMAGE_HOSTS.some(host => u.hostname === host || u.hostname.endsWith(`.${host}`)) ? u.href : '';
  } catch { return ''; }
}

function text(value: unknown, max: number): string {
  return typeof value === 'string' ? value.slice(0, max) : '';
}

function address(value: any): HozasdElAddress {
  const valid = typeof value?.lat === 'number' && Number.isFinite(value.lat) && Math.abs(value.lat) <= 90
    && typeof value?.lng === 'number' && Number.isFinite(value.lng) && Math.abs(value.lng) <= 180;
  const label = text(value?.address, 300);
  return { address: label, lat: valid ? value.lat : null, lng: valid ? value.lng : null,
    confirmed: Boolean(label && valid && value?.confirmed === true) };
}

export function saveHozasdEl(key: string, data: HozasdElDraft, ownerId: string | null): boolean {
  try {
    sessionStorage.setItem(key, JSON.stringify({ v: 1, at: Date.now(), ownerId, data }));
    return true;
  } catch { return false; }
}

export function readHozasdEl(key: string, ownerId: string | null): HozasdElDraft | null {
  try {
    const raw = sessionStorage.getItem(key);
    if (!raw) return null;
    const stored = JSON.parse(raw);
    if (stored?.v !== 1 || typeof stored.at !== 'number' || !Number.isFinite(stored.at)
      || stored.at > Date.now() || Date.now() - stored.at > MAX_AGE
      || (stored.ownerId !== null && stored.ownerId !== ownerId)
      || !stored.data || typeof stored.data !== 'object') {
      clearHozasdEl(key);
      return null;
    }
    const d = stored.data;
    const manual = d.manual === true;
    return { url: text(d.url, 2048), title: text(d.title, 120),
      description: manual ? '' : text(d.description, 500),
      image: manual ? '' : safeProductImage(d.image),
      sourceName: !manual && STORES.includes(d.sourceName) ? d.sourceName : '',
      ready: d.ready === true, manual, pickup: address(d.pickup), dropoff: address(d.dropoff) };
  } catch {
    clearHozasdEl(key);
    return null;
  }
}

export function clearHozasdEl(key?: string): void {
  try {
    if (key) sessionStorage.removeItem(key);
    else {
      sessionStorage.removeItem(HOZASD_EL_DRAFT);
      sessionStorage.removeItem(HOZASD_EL_PREFILL);
    }
  } catch { /* letiltott böngészőtároló */ }
}
