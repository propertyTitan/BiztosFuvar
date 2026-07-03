// Kapcsolatfelvételi díj — a GoFuvar készpénzes modelljének díjszabása.
//
// ÜZLETI DÖNTÉS (2026-07-03, CLAUDE.md #5): a platform nem a fuvardíjat
// kezeli, hanem az ÖSSZEKÖTTETÉST adja el. A feladó a licit elfogadásakor
// sávos, BEVEZETŐ árú kapcsolatfelvételi díjat fizet (kártyával, Barion),
// cserébe azonnal megkapja a sofőr elérhetőségét és elindul a fuvar-folyamat
// (SMS-ek, átvételi kód, tracking). A fuvardíjat a sofőr KÉSZPÉNZBEN kapja.
//
// A díj a szolgáltatás (kapcsolat-létrehozás) teljesítésével elhasználódik:
// nem visszatérítendő (45/2014. Korm. r. 29. § (1) a) — kifejezett
// beleegyezés + tudomásulvétel a fizetésnél kötelező). Ha a választott
// sofőrrel a fuvar meghiúsul, a feladó UGYANARRA a fuvarra díjmentesen
// választhat másik sofőrt a korábbi ajánlatok közül — másik fuvarra a
// befizetett díj nem vihető át.
//
// A sávok bruttó (27% ÁFA-t tartalmazó) árak. "Bevezető díj": a launch-
// időszak árazása, a platform a díjszabás változtatásának jogát az ÁSZF-ben
// fenntartja.

const CONNECTION_FEE_TIERS = [
  { maxPriceHuf: 20000, feeHuf: 500 },
  { maxPriceHuf: 50000, feeHuf: 1490 },
  { maxPriceHuf: 100000, feeHuf: 2490 },
  { maxPriceHuf: Infinity, feeHuf: 3990 },
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
