// Csomag méret kategóriák — egységes definíció a mobil kliens számára.
// A backend-nél és webnél pontosan UGYANEZT használjuk, lásd:
//   backend/src/constants.js
//   web/src/lib/packageSizes.ts

export type PackageSizeId = 'S' | 'M' | 'L' | 'XL';

export type PackageSize = {
  id: PackageSizeId;
  label_hu: string;
  description_hu: string;
  max_length_cm: number;
  max_width_cm: number;
  max_height_cm: number;
  max_weight_kg: number;
};

export const PACKAGE_SIZES: PackageSize[] = [
  {
    id: 'S',
    label_hu: 'Kicsi',
    description_hu: 'max 30 × 20 × 10 cm, 2 kg',
    max_length_cm: 30,
    max_width_cm: 20,
    max_height_cm: 10,
    max_weight_kg: 2,
  },
  {
    id: 'M',
    label_hu: 'Közepes',
    description_hu: 'max 50 × 40 × 30 cm, 10 kg',
    max_length_cm: 50,
    max_width_cm: 40,
    max_height_cm: 30,
    max_weight_kg: 10,
  },
  {
    id: 'L',
    label_hu: 'Nagy',
    description_hu: 'max 80 × 60 × 50 cm, 25 kg',
    max_length_cm: 80,
    max_width_cm: 60,
    max_height_cm: 50,
    max_weight_kg: 25,
  },
  {
    id: 'XL',
    label_hu: 'Extra nagy',
    description_hu: 'max 150 × 100 × 80 cm, 50 kg',
    max_length_cm: 150,
    max_width_cm: 100,
    max_height_cm: 80,
    max_weight_kg: 50,
  },
];

/**
 * Legkisebb méret-kategória, amibe a csomag belefér.
 */
export function classifyPackage(
  L: number,
  W: number,
  H: number,
  kg: number,
): PackageSizeId | null {
  const dims = [L, W, H].sort((a, b) => b - a);
  const [longest, middle, shortest] = dims;

  for (const size of PACKAGE_SIZES) {
    const catDims = [size.max_length_cm, size.max_width_cm, size.max_height_cm].sort((a, b) => b - a);
    if (
      longest <= catDims[0] &&
      middle <= catDims[1] &&
      shortest <= catDims[2] &&
      kg <= size.max_weight_kg
    ) {
      return size.id;
    }
  }
  return null;
}
