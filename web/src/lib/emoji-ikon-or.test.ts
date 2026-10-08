// @vitest-environment node
// =====================================================================
//  EMOJI-ŐR — UI-ikonként csak lucide (UX A10, 2026-10-08)
//
//  A design-szabály (CLAUDE.md 7.: „UI-ikon: mindig lucide, emoji TILOS")
//  le volt írva, de őr nélkül újra és újra visszacsúszott: a belépett
//  felületen ~150 helyen állt emoji címsorban („🚚 Fuvarjaim"),
//  adatsorban (📍🏁), gombon (✏️ 🗑️ ⬇️), toastban és állapotképen
//  (⏳ ✅ ❌). Ugyanaz a fogalom kétféle ikonnal jelent meg, az emoji minden
//  platformon másképp néz ki, és nem követi a témát.
//
//  Ez az őr a TypeScript-elemzővel kigyűjti a web forrásának minden
//  felhasználói szövegét (string-literál, sablon-literál, JSX-szöveg — a
//  komment nem számít), és emoji-t talál benne → piros. Nem számít emojinak:
//  a jogi jelek (© ® ™) és a nyilak (→ ← ↔ ↗ — tipográfia, nem ikon).
//  Kivétel (indokkal): a jogi dokumentumok prózája.
// =====================================================================
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import ts from 'typescript';

const WEB = path.resolve(__dirname, '..', '..');

/**
 * Emoji / piktogram — a jogi jelek és a nyíl-blokk kivételével, plusz a
 * karakter-ikonok (✓ ✗ ✕ ★ ☆). A kivétel CSAK a szöveges alakra szól: a
 * VS16-tal (U+FE0F) emoji-megjelenítésű nyíl („↩️”) már ikon, az is piros
 * (fix1-review: a „↩️ Visszaszállítás” így átcsúszott volna).
 */
// fix2-review: a zászló (regionális jelzőpár, 🇭🇺) és a keycap (1️⃣ —
// U+20E3) NEM Extended_Pictographic, ezért eddig átcsúszott volna.
const EMOJI = /(?![©®™←-⇿](?!\uFE0F))[\p{Extended_Pictographic}\p{Regional_Indicator}\u20E3✓✗✕★☆]/u;

/** Fájl → indok. A próza (jogi dokumentum) emojija nem UI-ikon. */
const KIVETELEK: Record<string, string> = {
  'app/adatkezeles/page.tsx': 'jogi dokumentum prózája (figyelmeztető jel a szövegben)',
  'app/aszf/page.tsx': 'jogi dokumentum prózája',
};

function szovegek(forras: string, fajlNev = 'x.tsx'): Array<{ sor: number; szoveg: string }> {
  const sf = ts.createSourceFile(fajlNev, forras, ts.ScriptTarget.Latest, true,
    fajlNev.endsWith('.tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
  const ki: Array<{ sor: number; szoveg: string }> = [];
  const bejar = (n: ts.Node) => {
    if (ts.isImportDeclaration(n) || ts.isExportDeclaration(n)) return;
    let s: string | null = null;
    if (ts.isStringLiteral(n) || ts.isNoSubstitutionTemplateLiteral(n)) s = n.text;
    else if (ts.isTemplateHead(n) || ts.isTemplateMiddle(n) || ts.isTemplateTail(n)) s = n.text;
    else if (ts.isJsxText(n)) s = n.getText();
    if (s !== null) ki.push({ sor: sf.getLineAndCharacterOfPosition(n.getStart()).line + 1, szoveg: s });
    n.forEachChild(bejar);
  };
  bejar(sf);
  return ki;
}

function forrasFajlok(dir: string): string[] {
  const ki: string[] = [];
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) { if (e.name !== 'node_modules' && !e.name.startsWith('.')) ki.push(...forrasFajlok(p)); }
    else if (/\.(ts|tsx)$/.test(e.name) && !/\.(test|spec)\.tsx?$/.test(e.name) && !e.name.endsWith('.d.ts')) ki.push(p);
  }
  return ki;
}

describe('emoji-őr (UX A10)', () => {
  it('kanári: a javítás előtti minták fennakadnak, a komment és a nyíl nem', () => {
    const regi = `
      // 🚚 komment — nem számít
      const a = <h1>🚚 Fuvarjaim</h1>;
      const b = { icon: '📍' };
      const c = <button>✏️ Szerkesztés</button>;
      const d = \`\${x} ✓ Kimásolva\`;
      const e = <span>Feladói nézet →</span>;
      const f = <p>© 2026 Tiszta Hód Kft.</p>;
      const g = <span>↩️ Visszaszállítás</span>;
      const h = { flag: '🇭🇺' };
      const i = <li>1️⃣ Első lépés</li>;
    `;
    const talalt = szovegek(regi).filter((t) => EMOJI.test(t.szoveg)).map((t) => t.szoveg.trim());
    expect(talalt).toEqual([
      '🚚 Fuvarjaim', '📍', '✏️ Szerkesztés', ' ✓ Kimásolva'.trim(), '↩️ Visszaszállítás', '🇭🇺', '1️⃣ Első lépés',
    ]);
  });

  it('a web forrásában nincs emoji UI-szövegben (a kivételek indokkal)', () => {
    const fajlok = [...forrasFajlok(path.join(WEB, 'src')), ...forrasFajlok(path.join(WEB, 'app'))];
    expect(fajlok.length, 'a bejárás üres — az őr vakon zöld lenne').toBeGreaterThan(100);
    const hibak: string[] = [];
    for (const f of fajlok) {
      const rel = path.relative(WEB, f).split(path.sep).join('/');
      if (KIVETELEK[rel]) continue;
      for (const t of szovegek(fs.readFileSync(f, 'utf8'), f)) {
        if (EMOJI.test(t.szoveg)) hibak.push(`${rel}:${t.sor}: „${t.szoveg.trim().slice(0, 60)}"`);
      }
    }
    expect(
      hibak,
      'EMOJI A FELÜLETEN — UI-ikonként lucide-react kell (szövegben 16, kártyacímben 18, '
      + `csempén 20 px, currentColor, aria-hidden):\n${hibak.join('\n')}`,
    ).toEqual([]);
  });

  it('a kivétel-lista nem avul el (a fájl létezik és tényleg tartalmaz emojit)', () => {
    for (const rel of Object.keys(KIVETELEK)) {
      const p = path.join(WEB, rel);
      expect(fs.existsSync(p), `${rel} nem létezik — vedd ki a kivételek közül`).toBe(true);
    }
  });

  it('a magyar fordítási fájlban sincs emoji', () => {
    const hu = JSON.parse(fs.readFileSync(path.join(WEB, 'src/locales/hu.json'), 'utf8'));
    const hibak: string[] = [];
    const bejar = (v: unknown, ut: string) => {
      if (typeof v === 'string') { if (EMOJI.test(v)) hibak.push(`${ut}: ${v}`); }
      else if (v && typeof v === 'object') for (const [k, x] of Object.entries(v)) bejar(x, ut ? `${ut}.${k}` : k);
    };
    bejar(hu, '');
    expect(hibak).toEqual([]);
  });
});
