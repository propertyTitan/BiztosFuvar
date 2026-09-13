// A szállító SAJÁT ajánlatának állapota egy fuvaron (2026-09-13, teljes audit D3).
//
// A `GET /jobs/:id/bids` a szállítónak a saját sorát STÁTUSZ NÉLKÜL adja
// vissza (a bids-en UNIQUE (job_id, carrier_id)): a visszavont / elutasított
// sor is visszajön. A fuvar-oldal eddig „van saját sor → nincs űrlap"
// alapon döntött, így a B1-es „Visszavonom" gomb után (és a szállító-csere
// utáni `rejected` állapotban) a szállító SOHA nem tudott új ajánlatot tenni
// — pedig a backend kifejezetten engedi (ON CONFLICT … WHERE status IN
// ('rejected','withdrawn')), és a visszavonás toastja ígéri is.
export type AjanlatSor = { carrier_id: string; status: string };

const AKTIV = new Set(['pending', 'accepted']);
const LEZARULT = new Set(['rejected', 'withdrawn']);

/** Az ÉLŐ saját ajánlat (várakozik / elfogadva) — ez tiltja az új ajánlatot. */
export function aktivSajatAjanlat<T extends AjanlatSor>(bids: T[], meId?: string | null): T | undefined {
  if (!meId) return undefined;
  return bids.find((b) => b.carrier_id === meId && AKTIV.has(b.status));
}

/** A LEZÁRULT saját ajánlat (visszavonva / elutasítva) — mellette új ajánlat tehető. */
export function lezarultSajatAjanlat<T extends AjanlatSor>(bids: T[], meId?: string | null): T | undefined {
  if (!meId) return undefined;
  if (aktivSajatAjanlat(bids, meId)) return undefined;
  return bids.find((b) => b.carrier_id === meId && LEZARULT.has(b.status));
}
