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
  // A rejtett funkció NÉGY további helyen szivárgott (2026-09-11, teljes audit
  // B1): a Fuvarjaim „Járataim" szekciója + „Új fix áras" gomb, a szállítói
  // üres állapot CTA-ja, a HomeHub „Foglalásaim" gyorslinkje, a stub-fizetés
  // vissza-linkje. Mindegyik a kapcsoló mögé került — ez az őr forrás-szinten
  // tartja ott.
  it('a négy korábbi szivárgási hely a kapcsoló mögött van', () => {
    const olvas = (rel: string) => readFileSync(path.join(process.cwd(), rel), 'utf8');
    const posted = olvas('src/components/fuvarjaim/PostedJobs.tsx');
    expect(posted).toContain("from '@/lib/features'");
    expect(posted).toContain('{JARAT_ENGEDELYEZVE && routes.map(');
    expect(posted).toMatch(/\{JARAT_ENGEDELYEZVE && \(\s*<Link className="btn btn-secondary" href="\/sofor\/uj-utvonal">/);
    expect(posted).toMatch(/\{JARAT_ENGEDELYEZVE && \(\s*<h2[^>]*>\s*<RouteIcon size=\{20\} \/> Járataim/);
    const fuvarok = olvas('app/sofor/fuvarok/page.tsx');
    expect(fuvarok).toContain('secondaryCta={JARAT_ENGEDELYEZVE ?');
    const hub = olvas('src/components/HomeHub.tsx');
    expect(hub).toContain("...(JARAT_ENGEDELYEZVE ? [{ href: '/fuvarjaim?tab=foglalasaim'");
    const stub = olvas('app/fizetes-stub/page.tsx');
    expect(stub).toContain("back: JARAT_ENGEDELYEZVE ? '/dashboard/foglalasaim' : '/fuvarjaim'");
  });
  it('a kapcsoló alapértelmezése KI (hiányzó env = rejtett)', () => {
    // A modul a betöltéskor olvassa az env-et; itt a szemantikát a
    // forrásból ellenőrizzük, hogy a feltétel szigorú egyenlőség maradjon.
    const src = readFileSync(path.join(process.cwd(), 'src/lib/features.ts'), 'utf8');
    expect(src).toContain("process.env.NEXT_PUBLIC_JARAT_ENABLED === 'true'");
  });
});
