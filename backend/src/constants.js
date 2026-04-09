// Csomag méret kategóriák — egységes definíció a backend-en.
// A GLS szabvány által ihletett, kicsit nagyobbra skálázva a fuvar-piacra
// (hogy bútorok és háztartási gépek is beleférjenek egy kategóriába).
//
// A kategóriák a frontend (web + mobil) oldalon is pontosan ugyanígy
// vannak definiálva, lásd:
//   web/src/lib/packageSizes.ts
//   mobile/src/constants.ts

/**
 * @typedef {Object} PackageSize
 * @property {'S'|'M'|'L'|'XL'} id
 * @property {string} label_hu
 * @property {string} description_hu
 * @property {number} max_length_cm
 * @property {number} max_width_cm
 * @property {number} max_height_cm
 * @property {number} max_weight_kg
 */

const PACKAGE_SIZES = [
  {
    id: 'S',
    label_hu: 'Kicsi',
    description_hu: 'max 30 × 20 × 10 cm, 2 kg — cipős doboz, kis doboz',
    max_length_cm: 30,
    max_width_cm: 20,
    max_height_cm: 10,
    max_weight_kg: 2,
  },
  {
    id: 'M',
    label_hu: 'Közepes',
    description_hu: 'max 50 × 40 × 30 cm, 10 kg — hátizsák, nagyobb doboz',
    max_length_cm: 50,
    max_width_cm: 40,
    max_height_cm: 30,
    max_weight_kg: 10,
  },
  {
    id: 'L',
    label_hu: 'Nagy',
    description_hu: 'max 80 × 60 × 50 cm, 25 kg — nagyobb doboz, bútorelem',
    max_length_cm: 80,
    max_width_cm: 60,
    max_height_cm: 50,
    max_weight_kg: 25,
  },
  {
    id: 'XL',
    label_hu: 'Extra nagy',
    description_hu: 'max 150 × 100 × 80 cm, 50 kg — bútorkarton, háztartási gép',
    max_length_cm: 150,
    max_width_cm: 100,
    max_height_cm: 80,
    max_weight_kg: 50,
  },
];

/**
 * Egy csomag méretei és súlya alapján visszaadja a legkisebb kategóriát,
 * amibe még belefér. A L/W/H sorrend nem számít (rendezzük), csak a
 * legnagyobbat vesszük a kategória max_length-jéhez, stb.
 *
 * @param {number} L
 * @param {number} W
 * @param {number} H
 * @param {number} kg
 * @returns {'S'|'M'|'L'|'XL'|null}  null ha semmibe sem fér bele
 */
function classifyPackage(L, W, H, kg) {
  // Rendezzük a három dimenziót csökkenő sorrendbe, hogy mindegy legyen, melyik oldal a "hossz"
  const dims = [Number(L), Number(W), Number(H)].sort((a, b) => b - a);
  const [longest, middle, shortest] = dims;
  const weight = Number(kg);

  for (const size of PACKAGE_SIZES) {
    const catDims = [size.max_length_cm, size.max_width_cm, size.max_height_cm].sort((a, b) => b - a);
    if (longest <= catDims[0] && middle <= catDims[1] && shortest <= catDims[2] && weight <= size.max_weight_kg) {
      return size.id;
    }
  }
  return null;
}

/**
 * Lemondási díj számítása az új szabályok szerint:
 *  - shipper_cancelled: 10% (max 1000 Ft)
 *  - minden más: 0
 */
const CANCELLATION_FEE_PCT = 0.10;
const CANCELLATION_FEE_MAX_HUF = 1000;

function cancellationFee(reason, amountHuf) {
  if (reason !== 'shipper_cancelled') return 0;
  return Math.min(Math.round(amountHuf * CANCELLATION_FEE_PCT), CANCELLATION_FEE_MAX_HUF);
}

module.exports = {
  PACKAGE_SIZES,
  classifyPackage,
  CANCELLATION_FEE_PCT,
  CANCELLATION_FEE_MAX_HUF,
  cancellationFee,
};
