// @vitest-environment node
// =====================================================================
//  FORRÁS-SZÖVEGŐR (UX A05, 2026-10-08)
//
//  A 13-as E2E-szövegőr csak a marketing-oldalak MEGJELENÍTETT szövegét
//  nézte. A belépett felületek szövegei így átcsúsztak: „Élő GPS-követés
//  hamarosan — a GoFuvar mobilapp érkezésével” (fuvaroldal, lezárt és
//  lemondott fuvaron is), „Térkép és élő követés” (ajánlatokra váró fuvar
//  térkép-gombja), „jogosítvány nem szükséges” (KYC-ablak), „A GoFuvar
//  mobilalkalmazással érkezik” (főoldal).
//
//  Ez az őr a FORRÁS minden felhasználói szövegét (string-literál,
//  sablon-literál, JSX-szöveg, hu.json) a TypeScript-elemzővel gyűjti ki
//  — a kommentek és az azonosítók nem számítanak —, és a szövegőr
//  „mindenhol” szabályait futtatja rajtuk. Kivétel a jogi és az admin-felület
//  (ugyanaz, mint a 16-os specben).
// =====================================================================
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import ts from 'typescript';
import {
  MINDENHOL_TILTOTT, szovegorKivetel, szovegorTalalatok,
} from '../../e2e/szovegor-szabalyok';

const WEB = path.resolve(__dirname, '../..');

/** Egy forrásfájl felhasználói szövegei, szóközzel összefűzve. */
function felhasznaloiSzovegek(forras: string, fajlNev = 'x.tsx'): string {
  const sf = ts.createSourceFile(fajlNev, forras, ts.ScriptTarget.Latest, true,
    fajlNev.endsWith('.tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
  const darabok: string[] = [];
  const bejar = (n: ts.Node) => {
    // Modul-útvonal (import/export ... from '…') nem felhasználói szöveg.
    if (ts.isImportDeclaration(n) || ts.isExportDeclaration(n)) return;
    if (ts.isStringLiteral(n) || ts.isNoSubstitutionTemplateLiteral(n)) darabok.push(n.text);
    else if (ts.isTemplateHead(n) || ts.isTemplateMiddle(n) || ts.isTemplateTail(n)) darabok.push(n.text);
    else if (ts.isJsxText(n)) darabok.push(n.getText());
    n.forEachChild(bejar);
  };
  bejar(sf);
  return darabok.join(' ');
}

function forrasFajlok(dir: string): string[] {
  const ki: string[] = [];
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) {
      if (e.name === 'node_modules' || e.name.startsWith('.')) continue;
      ki.push(...forrasFajlok(p));
    } else if (/\.(ts|tsx)$/.test(e.name) && !/\.(test|spec)\.tsx?$/.test(e.name) && !e.name.endsWith('.d.ts')) {
      ki.push(p);
    }
  }
  return ki;
}

/** A fájl útvonala az oldal-leltár szerint (a kivételekhez). */
function utvonal(fajl: string): string {
  const rel = path.relative(WEB, fajl).split(path.sep).join('/');
  if (rel.startsWith('app/')) return '/' + rel.slice('app/'.length);
  // Az admin-felület komponensei is admin-oldalak.
  if (rel.startsWith('src/components/admin/')) return '/admin';
  return '/' + rel;
}

describe('forrás-szövegőr: a felhasználói szövegek a szövegszabályok szerint', () => {
  it('a kigyűjtő a kommentet nem, a literált és a JSX-szöveget igen látja (kanári)', () => {
    // A javítás ELŐTTI két sor szó szerint — az őrnek ezeket meg kell fognia.
    const regi = `
      // élő követés mobilapp — komment, nem számít
      const a = <span>{driver ? 'x' : 'Élő GPS-követés hamarosan — a GoFuvar mobilapp érkezésével'}</span>;
      const b = { driver: 'Szállítóként a személyi igazolványod elegendő — jogosítvány nem szükséges.' };
      const c = <MapCollapse title="Térkép és élő követés" />;
      const d = <p>A GoFuvar mobilalkalmazással érkezik</p>;
    `;
    const szoveg = felhasznaloiSzovegek(regi);
    expect(szoveg).not.toContain('komment, nem számít');
    const talalatok = szovegorTalalatok(szoveg, MINDENHOL_TILTOTT);
    expect(talalatok.join('\n')).toMatch(/mobilapp/);
    expect(talalatok.join('\n')).toMatch(/jogosítvány/);
    expect(talalatok.join('\n')).toMatch(/élő követés/);
    expect(talalatok.join('\n')).toMatch(/mobilalkalmaz/);
    // A javított forma átmegy.
    const uj = `const x = <>{'Élő követés: hamarosan'}<p>Szállítóként elég a személyi igazolványod.</p></>;`;
    expect(szovegorTalalatok(felhasznaloiSzovegek(uj), MINDENHOL_TILTOTT)).toEqual([]);
  });

  it('a web forrásában (a jogi és az admin-felület kivételével) nincs tiltott szöveg', () => {
    const fajlok = [...forrasFajlok(path.join(WEB, 'src')), ...forrasFajlok(path.join(WEB, 'app'))];
    expect(fajlok.length, 'a fájl-bejárás üres — az őr vakon zöld lenne').toBeGreaterThan(100);
    const hibak: string[] = [];
    for (const f of fajlok) {
      if (szovegorKivetel(utvonal(f))) continue;
      const t = szovegorTalalatok(felhasznaloiSzovegek(fs.readFileSync(f, 'utf8'), f), MINDENHOL_TILTOTT);
      if (t.length) hibak.push(`${path.relative(WEB, f)}:\n${t.join('\n')}`);
    }
    expect(hibak, `TILTOTT SZÖVEG a forrásban:\n${hibak.join('\n\n')}`).toEqual([]);
  });

  it('a magyar fordítási fájlban sincs tiltott szöveg', () => {
    const hu = JSON.parse(fs.readFileSync(path.join(WEB, 'src/locales/hu.json'), 'utf8'));
    const ertekek: string[] = [];
    const gyujt = (v: unknown) => {
      if (typeof v === 'string') ertekek.push(v);
      else if (v && typeof v === 'object') Object.values(v).forEach(gyujt);
    };
    gyujt(hu);
    expect(ertekek.length).toBeGreaterThan(50);
    expect(szovegorTalalatok(ertekek.join(' '), MINDENHOL_TILTOTT)).toEqual([]);
  });
});
