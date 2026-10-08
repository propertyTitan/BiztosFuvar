// =====================================================================
//  Fuvar-állapotok — EGY forrás a feliratokra és a színekre
//  (2026-10-08, UX-átvizsgálás A12)
//
//  Hat helyen élt külön felirat- és színlista, és egymásnak ellentmondtak:
//  a Fuvarjaimban minden aktív fuvar kék volt (a „Vitatott" is), a
//  fuvaroldalon a „Vitatott" ugyanolyan borostyán, mint az „Elfogadva",
//  fizetett és fizetetlen fuvar egyaránt „Elfogadva" volt, ugyanarra az
//  állapotra „Lerakva" / „Teljesített" / „megérkezett" is szólt. A
//  felhasználó a jelvényből tájékozódik: ha a felirat két különböző
//  teendőt takar, nem látja, hol kell cselekednie.
//
//  A felirat a `status` ÉS a `paid_at` mezőből jön:
//    Ajánlatokat vár → Díjfizetésre vár → Felvételre vár → Úton →
//    Kézbesítve · Vita folyamatban · Lemondva
//  Szállítói nézetben a díj előtti/utáni állapot a szállító teendőjét
//  mondja („…a feladó díjfizetésére vár" / „Indulhat a fuvar").
// =====================================================================

export type StatuszNezet = 'felado' | 'szallito';

/** A jelvény színcsaládja (StatusPill → literál rgba-tint + pont). */
export type StatuszTonus = 'ajanlat' | 'teendo' | 'felvetel' | 'uton' | 'kesz' | 'vita' | 'lezart';

export type Statusz = { kulcs: string; felirat: string; tonus: StatuszTonus };

type FuvarAllapot = {
  status: string;
  paid_at?: string | null;
};

/** A fuvar állapota a nézőnek (feladó vagy a kijelölt szállító). */
export function fuvarStatusz(job: FuvarAllapot, nezet: StatuszNezet = 'felado'): Statusz {
  const fizetve = Boolean(job.paid_at);
  switch (job.status) {
    case 'pending':
    case 'bidding':
      return { kulcs: 'ajanlatokat_var', felirat: 'Ajánlatokat vár', tonus: 'ajanlat' };
    case 'accepted':
      if (!fizetve) {
        return nezet === 'szallito'
          ? { kulcs: 'dijfizetesre_var', felirat: 'Elfogadva — a feladó díjfizetésére vár', tonus: 'teendo' }
          : { kulcs: 'dijfizetesre_var', felirat: 'Díjfizetésre vár', tonus: 'teendo' };
      }
      return nezet === 'szallito'
        ? { kulcs: 'felvetelre_var', felirat: 'Indulhat a fuvar', tonus: 'felvetel' }
        : { kulcs: 'felvetelre_var', felirat: 'Felvételre vár', tonus: 'felvetel' };
    case 'in_progress':
      return { kulcs: 'uton', felirat: 'Úton', tonus: 'uton' };
    case 'delivered':
    case 'completed':
      return { kulcs: 'kezbesitve', felirat: 'Kézbesítve', tonus: 'kesz' };
    case 'disputed':
      return { kulcs: 'vita', felirat: 'Vita folyamatban', tonus: 'vita' };
    case 'cancelled':
    case 'expired':
      return { kulcs: 'lemondva', felirat: 'Lemondva', tonus: 'lezart' };
    default:
      return { kulcs: job.status, felirat: job.status, tonus: 'lezart' };
  }
}

/**
 * A kézbesített fuvar lezárásának magyarázata a FELADÓNAK (A1).
 *
 * A backend a feladói kóddal zárt fuvart eddig MINDIG
 * „sender_emergency"-ként naplózta — címzett nélkül is, pedig ott (ez az
 * alapeset) a feladó saját kódja AZ átvételi kód. A sárga „vészhelyzeti
 * kóddal zárult" sáv így szinte minden sikeres fuvaron megjelent. Mostantól:
 *  - vészhelyzeti figyelmeztetés CSAK, ha volt külön címzett;
 *  - egyébként egy nyugodt „Kézbesítve: … — az átvételi kódoddal lezárva."
 * A régi (címzett nélküli, 'sender_emergency') sorokra is helyes a szöveg,
 * mert a döntés a címzett meglétén múlik.
 */
export function lezarasInfo(job: {
  status: string;
  status_before_dispute?: string | null;
  closed_by_code_type?: string | null;
  recipient_name?: string | null;
  recipient_phone?: string | null;
  delivered_at?: string | null;
}): { tipus: 'veszhelyzeti' | 'rendben'; kodja: 'sajat' | 'cimzett' | null } | null {
  const fizikai = job.status === 'disputed' ? job.status_before_dispute : job.status;
  if (!['delivered', 'completed'].includes(String(fizikai))) return null;
  const vanCimzett = Boolean(job.recipient_name || job.recipient_phone);
  const tipus = job.closed_by_code_type;
  if (tipus === 'sender_emergency' && vanCimzett) return { tipus: 'veszhelyzeti', kodja: 'sajat' };
  if (tipus === 'sender' || tipus === 'sender_emergency') return { tipus: 'rendben', kodja: 'sajat' };
  if (tipus === 'recipient') return { tipus: 'rendben', kodja: 'cimzett' };
  return { tipus: 'rendben', kodja: null };
}
