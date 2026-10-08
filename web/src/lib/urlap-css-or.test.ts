// =====================================================================
//  ŰRLAP-CSS ŐR — UX-kör A7 + A8 (2026-10-08)
//
//  Két, a képernyőképeken (Chromium) nem látszó, de kódból egyértelmű hiba:
//   (A7) az iOS Safari minden 16 px-nél kisebb betűs mezőre fókuszáláskor
//        ránagyít — a mezők 14 px-esek voltak, és több komponens inline
//        fontSize-zal (11–14 px) is visszaírta;
//   (A8) a mezőkeret a kártyakeret volt (--border, fehéren 1,23:1 — a WCAG
//        1.4.11 3:1-et kér), a fókuszt `outline: none` + 15%-os árnyék
//        jelezte (~2,1:1), hibaállapot-osztály pedig nem volt.
//  CSS-t a jsdom nem renderel (vitest `css: false`), ezért az őr a
//  globals.css SZÖVEGÉT és a .tsx-ek inline stílusait olvassa — és a
//  kontrasztot a fájlban álló színekből SZÁMOLJA, nem elhiszi.
// =====================================================================
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

const WEB = path.resolve(__dirname, '..', '..');
const CSS = fs.readFileSync(path.join(WEB, 'app', 'globals.css'), 'utf8');

/** Egy CSS-blokk törzse a szelektora alapján (az első egyezés). */
function blokk(szelekor: string): string {
  const i = CSS.indexOf(szelekor);
  expect(i, `nincs ilyen blokk a globals.css-ben: ${szelekor}`).toBeGreaterThan(-1);
  const kezd = CSS.indexOf('{', i);
  let mely = 0;
  for (let j = kezd; j < CSS.length; j++) {
    if (CSS[j] === '{') mely++;
    if (CSS[j] === '}') { mely--; if (mely === 0) return CSS.slice(kezd + 1, j); }
  }
  throw new Error('lezáratlan blokk');
}
function tokenErtek(torzs: string, nev: string): string {
  const m = torzs.match(new RegExp(`${nev}:\\s*(#[0-9a-fA-F]{6})`));
  expect(m, `${nev} nincs hex-értékkel megadva`).not.toBeNull();
  return m![1];
}
function lum(hex: string) {
  const c = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255)
    .map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
  return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
}
function kontraszt(a: string, b: string) {
  const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p);
  return (x + 0.05) / (y + 0.05);
}

const VILAGOS = blokk(':root {');
const SOTET = blokk(":root[data-theme='dark'] {");

describe('A8: a mezőhatár és a fókusz 3:1 felett (WCAG 1.4.11)', () => {
  for (const [tema, torzs] of [['világos', VILAGOS], ['sötét', SOTET]] as const) {
    it(`${tema} téma: --border-input a felületen és a háttéren is ≥ 3:1`, () => {
      const keret = tokenErtek(torzs, '--border-input');
      for (const hatter of ['--surface', '--bg', '--surface-hover']) {
        const h = tokenErtek(torzs, hatter);
        expect(kontraszt(keret, h), `${tema}: ${keret} a ${hatter} (${h}) felületen`).toBeGreaterThanOrEqual(3);
      }
    });
    it(`${tema} téma: a fókuszgyűrű ≥ 3:1, a borostyán szöveg ≥ 4,5:1`, () => {
      const hatter = tokenErtek(torzs, '--surface');
      expect(kontraszt(tokenErtek(torzs, '--focus-ring'), hatter)).toBeGreaterThanOrEqual(3);
      expect(kontraszt(tokenErtek(torzs, '--warning-text'), hatter)).toBeGreaterThanOrEqual(4.5);
    });
  }

  it('a mezők a --border-input-ot használják, és nincs `outline: none`', () => {
    const mezo = blokk(".input, input:not([type='checkbox']):not([type='radio']), select, textarea {");
    expect(mezo).toMatch(/border:\s*1\.5px solid var\(--border-input\)/);
    expect(mezo, 'az `outline: none` elnyelte a fókuszgyűrűt (a specificitása nagyobb)').not.toMatch(/outline:\s*none/);
    const fokusz = blokk('.input:focus, input:focus, select:focus, textarea:focus {');
    expect(fokusz).toMatch(/outline:\s*3px solid var\(--focus-ring\)/);
  });

  it('egységes hibaállapot: aria-invalid → piros keret + halvány háttér, sötétben is', () => {
    expect(CSS).toMatch(/input:not\(\[type='checkbox'\]\):not\(\[type='radio'\]\)\[aria-invalid='true'\]/);
    expect(CSS).toMatch(/\[data-theme='dark'\] :is\(input, select, textarea, \.input\)\[aria-invalid='true'\]/);
    expect(blokk('.field-error {')).toMatch(/color:\s*var\(--danger-text\)/);
    // Sötétben a `[data-theme='dark'] body *` (0,1,1) fehérre írná — külön,
    // erősebb szabály kell (eddig az inline szín védte).
    expect(blokk("[data-theme='dark'] .field-error,")).toMatch(/color:\s*var\(--danger-text\)/);
  });
});

describe('A8: borostyán SZÖVEG csak a --warning-text tokennel', () => {
  // A --warning (#f59e0b) fehéren 2,15:1 — szövegszínként olvashatatlan.
  // Ikon (lucide `color=` attribútum) és háttér maradhat --warning; inline
  // `color: 'var(--warning)'` stílus viszont szöveget színez.
  it('nincs inline `color: var(--warning)` szöveg a .tsx-ekben', () => {
    const talalatok: string[] = [];
    const bejar = (dir: string) => {
      for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
        if (e.name === 'node_modules' || e.name.startsWith('.')) continue;
        const p = path.join(dir, e.name);
        if (e.isDirectory()) { bejar(p); continue; }
        if (!p.endsWith('.tsx') || p.includes('.test.')) continue;
        fs.readFileSync(p, 'utf8').split('\n').forEach((sor, i) => {
          if (/color:\s*['"]var\(--warning\)['"]/.test(sor)) talalatok.push(`${path.relative(WEB, p)}:${i + 1}`);
        });
      }
    };
    bejar(path.join(WEB, 'src'));
    bejar(path.join(WEB, 'app'));
    expect(talalatok, `szöveg a --warning színnel (használd a --warning-text-et): ${talalatok.join(', ')}`).toEqual([]);
  });
});

describe('A7: iOS-en a mezők nem nagyítanak (16 px mobilon)', () => {
  const mobil = (() => {
    const i = CSS.indexOf('/* iOS ZOOM');
    expect(i).toBeGreaterThan(-1);
    return CSS.slice(i, CSS.indexOf('/* ── Grid & Flex helpers', i));
  })();

  it('768 px alatt a mezők alap betűmérete 16 px', () => {
    expect(mobil).toMatch(/@media \(max-width: 768px\)/);
    expect(mobil).toMatch(/textarea \{\s*font-size: 16px;/);
  });

  it('minden 16 px alatti inline fontSize-t (mező) a mobil szabály felülír', () => {
    // A .tsx-ekben a <input|textarea|select> SAJÁT inline fontSize-ai.
    const kicsik = new Map<number, string[]>();
    const bejar = (dir: string) => {
      for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
        if (e.name === 'node_modules' || e.name.startsWith('.')) continue;
        const p = path.join(dir, e.name);
        if (e.isDirectory()) { bejar(p); continue; }
        if (!p.endsWith('.tsx') || p.includes('.test.')) continue;
        const t = fs.readFileSync(p, 'utf8');
        const re = /<(input|textarea|select)\b/g;
        let m: RegExpExecArray | null;
        // eslint-disable-next-line no-cond-assign
        while ((m = re.exec(t))) {
          let mely = 0; let j = m.index;
          for (; j < t.length; j++) {
            if (t[j] === '{') mely++;
            else if (t[j] === '}') mely--;
            else if (t[j] === '>' && mely === 0) break;
          }
          const fm = t.slice(m.index, j).match(/fontSize:\s*(\d+(?:\.\d+)?)/);
          if (fm && Number(fm[1]) < 16) {
            const v = Number(fm[1]);
            kicsik.set(v, [...(kicsik.get(v) ?? []), path.relative(WEB, p)]);
          }
        }
      }
    };
    bejar(path.join(WEB, 'src'));
    bejar(path.join(WEB, 'app'));
    for (const [v, helyek] of kicsik) {
      expect(Number.isInteger(v), `tört fontSize egy mezőn: ${v} (${helyek.join(', ')})`).toBe(true);
      expect(mobil, `a ${v} px-es inline mező-betűméret nincs felülírva mobilon: ${helyek.join(', ')}`)
        .toContain(`[style*='font-size:${v}px'], [style*='font-size: ${v}px']`);
    }
    expect(mobil).toMatch(/font-size: 16px !important/);
  });
});
