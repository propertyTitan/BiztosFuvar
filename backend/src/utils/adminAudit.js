// =====================================================================
//  Admin-hozzáférési napló — ki nézte meg a legérzékenyebb adatokat?
//
//  Az adatkezelési tájékoztató „File-hozzáférési audit log: 1 évig" megőrzést
//  ígér; 2026-08-09-ig ilyen napló nem létezett. Az admin nyomtalanul
//  megnyithatta a személyi igazolvány fotóját (aláírt linkkel), a felek
//  PRIVÁT chatjét és a teljes user-részletnézetet.
//
//  ELV: a napló a HOZZÁFÉRÉS TÉNYÉT rögzíti, nem a tartalmat — különben maga
//  a napló válna a kiszivárogtatott adat második példányává.
//
//  Sose dob: egy naplózási hiba nem akaszthatja meg az admin munkáját (de a
//  hibát kiírjuk, hogy észrevehető legyen).
// =====================================================================

const db = require('../db');

/**
 * @param {object} req — az Express kérés (a hitelesített adminnal)
 * @param {string} action — mit csinált, pl. 'kyc_documents_list'
 * @param {{type?: string, id?: string}} [target] — melyik entitáson
 */
async function logAdminAccess(req, action, target = {}) {
  try {
    await db.query(
      `INSERT INTO admin_access_log (admin_id, action, target_type, target_id)
       VALUES ($1, $2, $3, $4)`,
      [req.user?.sub || null, action, target.type || null, target.id || null],
    );
  } catch (err) {
    console.error('[admin-audit] naplózás sikertelen:', err.message);
  }
}

module.exports = { logAdminAccess };
