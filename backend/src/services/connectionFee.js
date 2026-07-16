// Kapcsolatfelvételi díj — a GoFuvar készpénzes modelljének díjszabása.
//
// ÜZLETI DÖNTÉS (2026-07-03, CLAUDE.md #5): a platform nem a fuvardíjat
// kezeli, hanem az ÖSSZEKÖTTETÉST adja el. A feladó a licit elfogadásakor
// sávos, BEVEZETŐ árú kapcsolatfelvételi díjat fizet (kártyával, Barion),
// cserébe azonnal megkapja a szállító elérhetőségét és elindul a fuvar-folyamat
// (SMS-ek, átvételi kód, tracking). A fuvardíjat a szállító KÉSZPÉNZBEN kapja.
//
// A díj a szolgáltatás (kapcsolat-létrehozás) teljesítésével elhasználódik:
// nem visszatérítendő (45/2014. Korm. r. 29. § (1) a) — kifejezett
// beleegyezés + tudomásulvétel a fizetésnél kötelező). Ha a választott
// szállítóval a fuvar meghiúsul, a feladó UGYANARRA a fuvarra díjmentesen
// választhat másik szállítót a korábbi ajánlatok közül — másik fuvarra a
// befizetett díj nem vihető át.
//
// A sávok bruttó (27% ÁFA-t tartalmazó) árak. "Bevezető díj": a launch-
// időszak árazása, a platform a díjszabás változtatásának jogát az ÁSZF-ben
// fenntartja.

// EGYSZERŰSÍTETT LAUNCH-ÁRAZÁS (2026-07-15, user + ügyvezető döntése):
// az elsődleges cél a felhasználók gyűjtése — két sáv, pofonegyszerű:
// 50 000 Ft fuvardíjig 500 Ft, felette 1 000 Ft. (A korábbi 4 sávos
// 500/1490/2490/3990 struktúra hatályon kívül; díjemelés legkorábban
// 2027 — lásd CLAUDE.md 5. szakasz.)
const CONNECTION_FEE_TIERS = [
  { maxPriceHuf: 50000, feeHuf: 500 },
  { maxPriceHuf: Infinity, feeHuf: 1000 },
];

/**
 * A megállapodott fuvardíjhoz tartozó kapcsolatfelvételi díj (bruttó Ft).
 * @param {number} agreedPriceHuf — a fuvar megállapodott ára Ft-ban
 * @returns {number} a díj bruttó Ft-ban
 */
function calculateConnectionFee(agreedPriceHuf) {
  const price = Number(agreedPriceHuf) || 0;
  const tier = CONNECTION_FEE_TIERS.find((t) => price <= t.maxPriceHuf);
  return tier.feeHuf;
}

module.exports = { calculateConnectionFee, CONNECTION_FEE_TIERS };
