import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';

// NOINDEX ŐR (2026-09-11, teljes audit C2): a robots.txt ma `Disallow: /`,
// a launchkor `Allow: /`-ra vált — akkor a privát, hitelesített oldalaknak
// SAJÁT `robots: { index: false }` kell, különben a keresők a bejelentkezés
// mögötti (üres / hibás) oldalakat indexelnék. A publikus marketing-oldalak
// viszont NEM kaphatnak noindexet.
const PRIVAT = [
  'app/dashboard/layout.tsx', 'app/dashboard/uj-fuvar/layout.tsx', 'app/dashboard/utvonalak/layout.tsx',
  'app/sofor/layout.tsx', 'app/sofor/dashboard/layout.tsx', 'app/sofor/fuvarok/layout.tsx',
  'app/sofor/uj-utvonal/layout.tsx', 'app/sofor/utvonalaim/layout.tsx',
  'app/admin/layout.tsx', 'app/fuvarjaim/layout.tsx', 'app/profil/layout.tsx', 'app/ai-chat/layout.tsx',
  'app/ertesitesek/layout.tsx', 'app/fizetes-stub/layout.tsx', 'app/uzenetek/layout.tsx',
  'app/nyomon-kovetes/[token]/layout.tsx',
];
const PUBLIKUS = ['app/aszf/layout.tsx', 'app/adatkezeles/layout.tsx', 'app/hozasd-el/layout.tsx', 'app/bejelentkezes/layout.tsx'];

describe('noindex a privát felületeken', () => {
  it('minden privát szegmens layoutja robots index:false', () => {
    for (const rel of PRIVAT) {
      const src = readFileSync(path.join(process.cwd(), rel), 'utf8');
      expect(src, `${rel}: nincs robots: { index: false }`).toMatch(/robots:\s*\{\s*index:\s*false/);
    }
  });
  it('a publikus oldalak NEM kapnak noindexet', () => {
    for (const rel of PUBLIKUS) {
      const src = readFileSync(path.join(process.cwd(), rel), 'utf8');
      expect(src, `${rel}: noindex került egy publikus oldalra`).not.toMatch(/index:\s*false/);
    }
  });
});
