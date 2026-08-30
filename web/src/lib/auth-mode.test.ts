// =====================================================================
//  MÓD-ÁTSZIVÁRGÁS ŐR — GF-006 (Manus, 2026-08-30)
//
//  A hiba: a Feladó/Szállító mód egyetlen GLOBÁLIS localStorage-kulcsban
//  élt ('gofuvar_mode'), és a kijelentkezés nem törölte — a következő
//  (MÁSIK!) fiók örökölte az előző módját: egy frissen regisztrált feladó
//  szállítói fejlécet és menüket látott. A stale-state osztály rokona
//  (BUG-015/030).
//
//  A javítás: a mód kulcsa a user id-jával képződik (gofuvar_mode:<id>) —
//  másik fiókhoz nem szivárog át, ugyanaz a fiók viszont visszakapja a
//  saját beállítását. Ez a fájl mindkét irányt méri, és egy forrás-őrrel
//  tartja, hogy a módhoz senki ne nyúljon a helperek megkerülésével.
// =====================================================================
import { describe, it, expect, beforeEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import {
  setCurrentUser, clearCurrentUser, readStoredMode, writeStoredMode,
  type CurrentUser,
} from './auth';

const userA: CurrentUser = { id: 'aaaa-1111', email: 'a@teszt.hu', role: 'shipper' };
const userB: CurrentUser = { id: 'bbbb-2222', email: 'b@teszt.hu', role: 'shipper' };

beforeEach(() => {
  window.localStorage.clear();
});

describe('A mód nem szivárog át fiókok között (GF-006)', () => {
  it('A fiók szállító-módja után a B fiók NEM örökli a módot', () => {
    setCurrentUser(userA, 'token-a');
    writeStoredMode('driver');
    clearCurrentUser();

    setCurrentUser(userB, 'token-b');
    expect(
      readStoredMode(),
      'A B fiók örökölte az A fiók szállító-módját — pontosan a Manus által '
      + 'jelentett átszivárgás: egy feladó szállítói fejlécet látott.',
    ).toBeNull();
  });

  it('ugyanaz a fiók visszakapja a saját módját újra-bejelentkezés után', () => {
    setCurrentUser(userA, 'token-a');
    writeStoredMode('driver');
    clearCurrentUser();

    setCurrentUser(userA, 'token-a2');
    expect(
      readStoredMode(),
      'A saját beállításnak túl kell élnie a ki-/bejelentkezést — a javítás '
      + 'nem lehet „mindig törlünk mindent", az a szállítókat büntetné.',
    ).toBe('driver');
  });

  it('kijelentkezés a RÉGI globális kulcsot is kitakarítja (legacy-védelem)', () => {
    window.localStorage.setItem('gofuvar_mode', 'driver');
    setCurrentUser(userA, 'token-a');
    clearCurrentUser();
    expect(
      window.localStorage.getItem('gofuvar_mode'),
      'A régi globális kulcs bent maradt — a javítás előtti böngészőkben '
      + 'tovább szivárogna a mód a következő fiókra.',
    ).toBeNull();
  });

  it('kijelentkezett állapotban nincs tárolt mód', () => {
    setCurrentUser(userA, 'token-a');
    writeStoredMode('driver');
    clearCurrentUser();
    expect(readStoredMode()).toBeNull();
  });
});

describe('Forrás-őr: a módhoz csak a helpereken át szabad nyúlni', () => {
  it("a 'gofuvar_mode' nyers kulcs csak a lib/auth.ts-ben szerepelhet", () => {
    // Ha bárki visszateszi a közvetlen localStorage-olvasást (ahogy a
    // HomeHub/SiteHeader/not-found csinálta), az a user-kulcsos védelem
    // megkerülése — az őr megnevezi a fájlt.
    const gyoker = path.resolve(__dirname, '..', '..');
    const vetkesek: string[] = [];
    const bejar = (mappa: string) => {
      for (const b of fs.readdirSync(mappa, { withFileTypes: true })) {
        const ut = path.join(mappa, b.name);
        if (b.isDirectory()) {
          if (['node_modules', '.next', 'coverage', 'e2e'].includes(b.name)) continue;
          bejar(ut);
          continue;
        }
        if (!/\.(ts|tsx)$/.test(b.name) || b.name.endsWith('.test.ts')) continue;
        const rel = path.relative(gyoker, ut);
        if (rel === path.join('src', 'lib', 'auth.ts')) continue;
        // Az adatkezelési tájékoztató TÁBLÁZATA leírhatja a kulcs nevét —
        // az dokumentáció, nem hozzáférés.
        if (rel === path.join('app', 'adatkezeles', 'page.tsx')) continue;
        if (fs.readFileSync(ut, 'utf8').includes('gofuvar_mode')) vetkesek.push(rel);
      }
    };
    bejar(path.join(gyoker, 'src'));
    bejar(path.join(gyoker, 'app'));
    expect(
      vetkesek,
      `Közvetlen 'gofuvar_mode' hozzáférés a helpereken kívül: ${vetkesek.join(', ')} — `
      + 'használd a readStoredMode/writeStoredMode-ot (lib/auth.ts), különben '
      + 'a fiókok közti mód-átszivárgás (GF-006) visszajöhet.',
    ).toEqual([]);
  });
});
