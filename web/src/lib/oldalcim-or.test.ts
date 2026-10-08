// =====================================================================
//  OLDALCÍM-ŐR — UX-kör A25 (2026-10-08)
//
//  A root layout `title.template`-je („%s | GoFuvar") minden szegmens-címhez
//  hozzáteszi a „| GoFuvar" utótagot. Ha a szegmens maga is kiírja, a
//  böngészőfülön és a keresőben „… | GoFuvar | GoFuvar" lesz — az ÁSZF és az
//  adatkezelési tájékoztató így jelent meg (jogi oldalon különösen hanyag
//  hatású). A képernyőolvasó és a mobilos lapváltó csak a címet mutatja,
//  ezért az azonos nevű oldalaknak is saját cím kell (WCAG 2.4.2).
// =====================================================================
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { ALL_LANDINGS } from './landings';

const WEB = path.resolve(__dirname, '..', '..');
const APP = path.join(WEB, 'app');

function fajlok(dir: string, out: string[] = []): string[] {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) fajlok(p, out);
    else if (/^(layout|page)\.tsx$/.test(e.name)) out.push(p);
  }
  return out;
}

/** A metadata-objektum FELSŐ szintű `title: '…'` értékei (openGraph/twitter nélkül). */
function cimek(src: string): string[] {
  const out: string[] = [];
  for (const sor of src.split('\n')) {
    if (/openGraph|twitter/.test(sor)) continue;
    const m = sor.match(/^ {2}title:\s*['"`]([^'"`]+)['"`]/);
    if (m) out.push(m[1]);
  }
  return out;
}

describe('a „GoFuvar" egy oldalcímben sem szerepelhet kétszer', () => {
  it('a szegmens-címek nem írják ki a template utótagját', () => {
    const hibak: string[] = [];
    for (const f of fajlok(APP)) {
      const rel = path.relative(WEB, f);
      if (rel === path.join('app', 'layout.tsx')) continue;
      for (const c of cimek(fs.readFileSync(f, 'utf8'))) {
        if (/GoFuvar/.test(c)) hibak.push(`${rel}: „${c}" → „${c} | GoFuvar"`);
      }
    }
    expect(hibak, `Dupla „GoFuvar" az oldalcímben:\n${hibak.join('\n')}`).toEqual([]);
  });

  it('a landingek meta-címei sem', () => {
    for (const c of ALL_LANDINGS) expect(c.metaTitle, c.slug).not.toMatch(/GoFuvar/);
  });

  it('a jogi oldalak címe pontosan a dokumentum neve', () => {
    const aszf = cimek(fs.readFileSync(path.join(APP, 'aszf', 'page.tsx'), 'utf8'));
    const adat = cimek(fs.readFileSync(path.join(APP, 'adatkezeles', 'page.tsx'), 'utf8'));
    expect(aszf).toEqual(['Általános Szerződési Feltételek (ÁSZF)']);
    expect(adat).toEqual(['Adatkezelési Tájékoztató (GDPR)']);
  });
});

describe('az azonos nevű oldalak saját címet kapnak', () => {
  it('a publikus profil, a fuvar-részletoldalak, az elfelejtett jelszó és a követőoldal', () => {
    const elvart: Record<string, string> = {
      'app/profil/[id]/layout.tsx': 'Felhasználói profil',
      'app/dashboard/fuvar/[id]/layout.tsx': 'Fuvar részletei',
      'app/sofor/fuvar/[id]/layout.tsx': 'Fuvar részletei — szállító',
      'app/elfelejtett-jelszo/layout.tsx': 'Elfelejtett jelszó',
      'app/nyomon-kovetes/[token]/layout.tsx': 'Csomagkövetés',
    };
    for (const [rel, cim] of Object.entries(elvart)) {
      expect(cimek(fs.readFileSync(path.join(WEB, rel), 'utf8')), rel).toEqual([cim]);
    }
  });

  it('a 404-oldal saját címet állít (kliens-komponens, ezért document.title)', () => {
    const src = fs.readFileSync(path.join(APP, 'not-found.tsx'), 'utf8');
    expect(src).toMatch(/document\.title = 'Az oldal nem található \| GoFuvar'/);
  });
});
