// =====================================================================
//  PII-PEPPER — a visszafejthetetlen lenyomatok szerver-oldali titka
//
//  ⚠️ MIÉRT KÜLÖN ENV (2026-08-11, séma-audit): eddig a `JWT_SECRET` volt a
//  pepper is. Két baj volt vele:
//
//   1. A JWT-titok rotálása NORMÁL biztonsági művelet — de NÉMÁN elrontotta
//      volna az „egy okmány = egy fiók" védelmet: a régi `doc_number_hash`
//      lenyomatok nem illeszkednének az újakhoz, tehát ugyanazzal a személyivel
//      korlátlanul nyílna új fiók. Semmi nem jelezte volna.
//   2. A `|| 'dev-secret'` fallback élesben is működött volna: ha a
//      `JWT_SECRET` valaha hiányzik, a pepper a PUBLIKUSAN ISMERT
//      'dev-secret' — és onnantól az okmányszám-lenyomat visszafejthető,
//      miközben három dokumentum állítja, hogy nem az.
//
//  A pepper mostantól SAJÁT env (`PII_PEPPER`), és élesben KÖTELEZŐ.
//  Fejlesztésben/tesztben a `JWT_SECRET`-re esik vissza — így a meglévő
//  lenyomatok érvényben maradnak, amíg a prod env be nem áll.
//
//  ⚠️ A PEPPER ROTÁLÁSA a meglévő lenyomatokat érvényteleníti. Ha valaha
//  szükség van rá, előbb el kell dönteni, mi legyen a `kyc_doc_history` és a
//  `deleted_accounts` régi soraival.
// =====================================================================

const crypto = require('crypto');

let figyelmeztetve = false;

/** A pepper — élesben kötelező, különben hangos figyelmeztetés. */
function pepper() {
  const sajat = process.env.PII_PEPPER;
  if (sajat) return sajat;

  const tartalek = process.env.JWT_SECRET;
  if (process.env.NODE_ENV === 'production' && !figyelmeztetve) {
    figyelmeztetve = true;
    console.error(
      '[pepper] ⚠️ A PII_PEPPER nincs beállítva — a lenyomatok a JWT_SECRET-tel '
      + 'készülnek. Ez ma működik, DE a JWT-titok rotálása némán érvénytelenítené '
      + 'az okmány-lenyomatokat („egy okmány = egy fiók"). Állítsd be a '
      + 'PII_PEPPER env-et (a JELENLEGI JWT_SECRET értékével, hogy a meglévő '
      + 'lenyomatok érvényben maradjanak).',
    );
  }
  if (!tartalek && process.env.NODE_ENV === 'production') {
    // Élesben a 'dev-secret' fallback elfogadhatatlan: a lenyomat
    // visszafejthetővé válna, miközben az ellenkezőjét állítjuk.
    throw new Error('[pepper] Sem PII_PEPPER, sem JWT_SECRET nincs beállítva élesben.');
  }
  return tartalek || 'dev-secret';
}

/** Visszafejthetetlen lenyomat (HMAC-SHA256) a szerver-oldali pepperrel. */
function hmac(ertek) {
  return crypto.createHmac('sha256', pepper()).update(String(ertek ?? '')).digest('hex');
}

module.exports = { hmac, pepper };
