import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';

// A járat-ág kapcsolójának STATIKUS őre (2026-09-11, D1): mind a hat járat-oldal
// default exportja a kapu-wrapper legyen — egy jövőbeli szerkesztés ne tudja
// némán levenni a „Hamarosan” képernyőt, amíg a funkció rejtett.
const OLDALAK = [
  'app/dashboard/utvonalak/page.tsx',
  'app/dashboard/utvonal/[id]/page.tsx',
  'app/sofor/uj-utvonal/page.tsx',
  'app/sofor/utvonalaim/page.tsx',
  'app/sofor/utvonal/[id]/page.tsx',
  'app/sofor/utvonal/[id]/utba-eso/page.tsx',
];

describe('járat-ág kapcsoló', () => {
  it('mind a hat járat-oldal a kapu-wrapperen át exportál', () => {
    for (const rel of OLDALAK) {
      const src = readFileSync(path.join(process.cwd(), rel), 'utf8');
      expect(src, `${rel}: nem importálja a JARAT_ENGEDELYEZVE kapcsolót`).toContain("from '@/lib/features'");
      expect(src, `${rel}: a default export nem a kapu-wrapper`).toMatch(/export default function \w+Kapu\(\)/);
      expect(src, `${rel}: a kapu nem a JaratHamarosan-t adja`).toContain('return <JaratHamarosan />');
    }
  });
  it('a kapcsoló alapértelmezése KI (hiányzó env = rejtett)', () => {
    // A modul a betöltéskor olvassa az env-et; itt a szemantikát a
    // forrásból ellenőrizzük, hogy a feltétel szigorú egyenlőség maradjon.
    const src = readFileSync(path.join(process.cwd(), 'src/lib/features.ts'), 'utf8');
    expect(src).toContain("process.env.NEXT_PUBLIC_JARAT_ENABLED === 'true'");
  });
});
