// =====================================================================
//  „Újra feladom" — a lemondott fuvar adatai új feladás piszkozataként
//  (2026-10-08, UX-átvizsgálás A21)
//
//  Aki lemond, gyakran csak az időpontot vagy az árat módosítaná. A
//  lemondott fuvar adataiból a MEGLÉVŐ fuvarfeladási piszkozatot töltjük
//  (lib/urlapPiszkozat — ugyanaz a kulcs, amit az új-fuvar űrlap betöltéskor
//  visszaállít), így külön URL-paraméter és szerver-hívás nem kell.
//
//  Szándékosan NEM visszük át: a felvételi időablakot (a régi már múltbeli
//  lehet), a fotókat (a fájlok nem a böngészőben vannak), és a „Hozasd el"
//  forrás-adatait. A címek a feladó SAJÁT, pontos címei — koordinátával
//  együtt megerősítettként kerülnek az űrlapba.
// =====================================================================
import type { Job } from '@/api';

type NumKey = 'length_cm' | 'width_cm' | 'height_cm' | 'weight_kg' | 'suggested_price_huf' | 'declared_value_huf';

export type UjrafeladasPiszkozat = {
  form: Record<string, unknown>;
  raw: Record<NumKey, string>;
  sourceStore: null;
  sourceImage: null;
  hozasdElKind: null;
  /**
   * Jelző az új-fuvar űrlapnak: a piszkozat egy LEMONDOTT fuvar másolata,
   * nem félbehagyott feladás — a betöltéskor ennek megfelelő üzenet jár
   * („Piszkozat visszaállítva — a félbehagyott feladásod” félrevezető volt).
   * Az első szerkesztéskor az automatikus mentés elhagyja.
   */
  ujrafeladas: true;
};

function szam(v: unknown): number | '' {
  if (v === null || v === undefined || v === '') return '';
  const n = Number(v);
  return Number.isFinite(n) && n >= 0 ? n : '';
}

function szoveg(n: number | ''): string {
  return n === '' ? '' : String(n);
}

function veges(v: unknown): number | null {
  const n = Number(v);
  return v !== null && v !== undefined && v !== '' && Number.isFinite(n) ? n : null;
}

export function ujrafeladasPiszkozat(job: Job): UjrafeladasPiszkozat {
  const szamok: Record<NumKey, number | ''> = {
    length_cm: szam(job.length_cm),
    width_cm: szam(job.width_cm),
    height_cm: szam(job.height_cm),
    weight_kg: szam(job.weight_kg),
    suggested_price_huf: szam(job.suggested_price_huf ?? job.accepted_price_huf),
    declared_value_huf: szam(job.declared_value_huf),
  };
  const pLat = veges(job.pickup_lat);
  const pLng = veges(job.pickup_lng);
  const dLat = veges(job.dropoff_lat);
  const dLng = veges(job.dropoff_lng);
  const masVesziAt = Boolean(job.recipient_name || job.recipient_phone);
  return {
    form: {
      title: job.title || '',
      description: job.description || '',
      pickup_address: job.pickup_address || '',
      pickup_lat: pLat,
      pickup_lng: pLng,
      pickup_confirmed: Boolean(job.pickup_address && pLat !== null && pLng !== null),
      dropoff_address: job.dropoff_address || '',
      dropoff_lat: dLat,
      dropoff_lng: dLng,
      dropoff_confirmed: Boolean(job.dropoff_address && dLat !== null && dLng !== null),
      ...szamok,
      pickup_needs_carrying: Boolean(job.pickup_needs_carrying),
      pickup_floor: String(job.pickup_floor ?? 0),
      pickup_has_elevator: Boolean(job.pickup_has_elevator),
      dropoff_needs_carrying: Boolean(job.dropoff_needs_carrying),
      dropoff_floor: String(job.dropoff_floor ?? 0),
      dropoff_has_elevator: Boolean(job.dropoff_has_elevator),
      invoice_requested: Boolean(job.invoice_requested),
      other_recipient: masVesziAt,
      recipient_name: masVesziAt ? job.recipient_name || '' : '',
      recipient_phone: masVesziAt ? job.recipient_phone || '' : '',
      recipient_email: masVesziAt ? job.recipient_email || '' : '',
    },
    raw: {
      length_cm: szoveg(szamok.length_cm),
      width_cm: szoveg(szamok.width_cm),
      height_cm: szoveg(szamok.height_cm),
      weight_kg: szoveg(szamok.weight_kg),
      suggested_price_huf: szoveg(szamok.suggested_price_huf),
      declared_value_huf: szoveg(szamok.declared_value_huf),
    },
    sourceStore: null,
    sourceImage: null,
    hozasdElKind: null,
    ujrafeladas: true,
  };
}
