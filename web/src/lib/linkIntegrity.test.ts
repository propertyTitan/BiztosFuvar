// Link-integritás osztály-teszt — a süti-banner /adatvedelem 404-ének
// tanulsága: egy belső link halott volta build-időben is kimutatható.
//
// Végigmegy az összes .tsx forráson, kigyűjti a statikus belső href-eket,
// és ellenőrzi, hogy mindegyikhez létezik App Router oldal (page.tsx),
// dinamikus szegmensekkel ([id]) is számolva. Új halott link = azonnal
// piros teszt, nem tesztelői fogás hetekkel később.
import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';

const WEB_ROOT = path.resolve(__dirname, '..', '..');
const APP_DIR = path.join(WEB_ROOT, 'app');

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === 'node_modules' || entry.name.startsWith('.')) continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full, out);
    else if (full.endsWith('.tsx') && !full.includes('.test.')) out.push(full);
  }
  return out;
}

/** Statikus belső href-ek kinyerése: href="/..." és href={'/...'} minták.
 *  A template-literálos (${...}) dinamikus linkeket kihagyjuk — azokat
 *  az E2E fedi. */
function extractHrefs(src: string): string[] {
  const out: string[] = [];
  const patterns = [
    /href="(\/[^"]*)"/g,
    /href=\{'(\/[^']*)'\}/g,
    /href=\{"(\/[^"]*)"\}/g,
  ];
  for (const re of patterns) {
    let m;
    // eslint-disable-next-line no-cond-assign
    while ((m = re.exec(src))) out.push(m[1]);
  }
  return out;
}

/** Egy útvonal feloldható-e az app/ könyvtárban (dinamikus [szegmens]
 *  fallbackkel)? */
function routeExists(route: string): boolean {
  const clean = route.split('?')[0].split('#')[0];
  if (clean === '/') return fs.existsSync(path.join(APP_DIR, 'page.tsx'));
  const segments = clean.split('/').filter(Boolean);

  function resolve(dir: string, idx: number): boolean {
    if (idx === segments.length) return fs.existsSync(path.join(dir, 'page.tsx'));
    const seg = segments[idx];
    const exact = path.join(dir, seg);
    if (fs.existsSync(exact) && resolve(exact, idx + 1)) return true;
    // dinamikus szegmens: [bármi]
    const entries = fs.existsSync(dir)
      ? fs.readdirSync(dir).filter((e) => e.startsWith('[') && e.endsWith(']'))
      : [];
    return entries.some((e) => resolve(path.join(dir, e), idx + 1));
  }
  return resolve(APP_DIR, 0);
}

describe('Belső linkek integritása', () => {
  it('minden statikus belső href létező oldalra mutat', () => {
    const files = [...walk(APP_DIR), ...walk(path.join(WEB_ROOT, 'src'))];
    const broken: string[] = [];
    for (const file of files) {
      const src = fs.readFileSync(file, 'utf8');
      for (const href of extractHrefs(src)) {
        if (!routeExists(href)) {
          broken.push(`${path.relative(WEB_ROOT, file)} → ${href}`);
        }
      }
    }
    expect(broken, `Halott belső link(ek):\n${broken.join('\n')}`).toEqual([]);
  });
});
