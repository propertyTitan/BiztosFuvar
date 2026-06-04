// Fuvar objektum-szintű jogosultság (IDOR-védelem).
//
// Több végpont fuvarhoz kötött érzékeny adatot ad vissza (fotók, escrow,
// élő pozíció, licitek). Korábban ezek CSAK auth-ot kértek, de NEM
// ellenőrizték, hogy a hívó valóban érintett-e az adott fuvarban — így
// bárki, aki ismert egy fuvar-UUID-t, kiolvashatta más fuvarjának privát
// adatait. Ez a helper egységesen eldönti, ki a fuvar "fele".

const db = require('../db');

// Betölti a fuvar tulajdonosi mezőit és eldönti a hívó viszonyát.
// Visszatérés: { job|null, notFound, isShipper, isCarrier, isAdmin, isParty }
async function getJobParty(jobId, user) {
  const { rows } = await db.query(
    'SELECT shipper_id, carrier_id FROM jobs WHERE id = $1',
    [jobId],
  );
  const job = rows[0];
  if (!job) {
    return { job: null, notFound: true, isShipper: false, isCarrier: false, isAdmin: false, isParty: false };
  }
  const uid = user && user.sub;
  const isShipper = !!uid && uid === job.shipper_id;
  const isCarrier = !!uid && uid === job.carrier_id;
  const isAdmin = !!user && user.role === 'admin';
  return {
    job,
    notFound: false,
    isShipper,
    isCarrier,
    isAdmin,
    isParty: isShipper || isCarrier || isAdmin,
  };
}

module.exports = { getJobParty };
