// @vitest-environment node
// =====================================================================
//  APRÓ CSS-HIBÁK ŐRE — UX A30 (2026-10-08)
//
//  (1) „btn ghost" (két helyen) — nem létező osztály, ezért a gomb
//      elsődleges kékként jelent meg, és rossz lépésre terelt;
//  (2) a kártya első h2-je 24 px felső margót kapott (44 px üres tér felül,
//      a szomszéd kártyán 20);
//  (3) a `.card:hover` a NEM kattintható kártyákon is árnyékot adott;
//  (4) mobilon az időablak két mezője között árva „–" lógott.
//  A CSS-t a jsdom nem rendereli — a szabályokat a forrásból olvassuk.
// =====================================================================
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

const WEB = path.resolve(__dirname, '..', '..');
const CSS = fs.readFileSync(path.join(WEB, 'app', 'globals.css'), 'utf8')
  .replace(/\/\*[\s\S]*?\*\//g, '');

function tsxFajlok(dir: string): string[] {
  const ki: string[] = [];
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) { if (e.name !== 'node_modules') ki.push(...tsxFajlok(p)); }
    else if (e.name.endsWith('.tsx') && !/\.test\.tsx$/.test(e.name)) ki.push(p);
  }
  return ki;
}

describe('apró CSS-hibák (UX A30)', () => {
  it('nincs előtag nélküli gomb-módosító („btn ghost", „btn secondary")', () => {
    const hibak: string[] = [];
    for (const f of [...tsxFajlok(path.join(WEB, 'app')), ...tsxFajlok(path.join(WEB, 'src'))]) {
      const s = fs.readFileSync(f, 'utf8');
      const m = s.match(/className="[^"]*\bbtn (ghost|secondary|danger|success|sm|lg)\b[^"]*"/g);
      if (m) hibak.push(`${path.relative(WEB, f)}: ${m.join(', ')}`);
    }
    expect(hibak, `a „btn-” előtag hiányzik — a gomb elsődleges kéknek látszik:\n${hibak.join('\n')}`)
      .toEqual([]);
  });

  it('a statikus kártya hoverre nem kap árnyékot — csak a kattintható', () => {
    // Csupasz `.card:hover` szelektor (nem a.card / button.card) tilos.
    const csupasz = CSS.match(/(^|[\s,}])\.card:hover/gm);
    expect(csupasz, 'a .card:hover minden kártyára hat — a statikus is „kattints rám”-ot ígér')
      .toBeNull();
    expect(CSS).toMatch(/\.card-interactive:hover/);
  });

  it('a kártya első címsora nem kap felső margót', () => {
    expect(CSS).toMatch(/\.card\s*>\s*:is\(h2,\s*h3\):first-child\s*\{\s*margin-top:\s*0/);
  });

  it('kiegyensúlyozott címsor-tördelés', () => {
    expect(CSS).toMatch(/h1,\s*h2,\s*h3\s*\{\s*text-wrap:\s*balance/);
  });

  it('az új fuvar időablaka két címkézett mező, árva „–” nélkül', () => {
    const s = fs.readFileSync(path.join(WEB, 'app/dashboard/uj-fuvar/page.tsx'), 'utf8');
    expect(s).toMatch(/>Legkorábban</);
    expect(s).toMatch(/>Legkésőbb</);
    expect(s).not.toMatch(/<span className="muted">–<\/span>/);
  });
});
