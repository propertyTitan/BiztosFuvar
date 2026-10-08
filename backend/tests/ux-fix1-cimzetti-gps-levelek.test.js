// =====================================================================
//  UX fix1-review (2026-10-08): a címzetti GPS-levelek szövege
//
//  A két GPS-pingre kimenő címzetti levél („beért a városba”, „mindjárt
//  megérkezik”) ma alvó kód (élő GPS csak a mobil-fázisban), de a szövegük
//  két szabályt sértett: „Ezt a PIN-t mondd meg…” (a fogalom: ÁTVÉTELI KÓD,
//  és csak az átadáskor adható meg — SMS-szabály 2026-09-10), illetve
//  „Kövesd élőben itt” (élő követés csak „hamarosan”-ként ígérhető, PR #48).
//  Forrás-őr: ha a mobil-fázis élesíti a pingeket, ne hamis szöveggel menjen ki.
// =====================================================================
import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';

const forras = fs.readFileSync(path.join(__dirname, '..', 'src', 'routes', 'tracking.js'), 'utf8');

describe('címzetti GPS-levelek (tracking.js)', () => {
  it('nem „PIN”, hanem átvételi kód — és csak az átadáskor adható meg', () => {
    expect(forras).not.toMatch(/PIN-t/);
    expect(forras).toMatch(/Ezt az átvételi kódot csak az átadáskor add meg a szállítónak\./);
  });

  it('nem ígér élő követést — a követő oldal a fuvar állapotát mutatja', () => {
    expect(forras).not.toMatch(/Kövesd élőben/i);
    expect(forras).toMatch(/A fuvar állapota itt látható/);
  });
});

// A chatbot-tudás ugyanezeket a szabályokat kövesse (fix1-review): az élő
// GPS-t nem köti apphoz (A05), a 2026-09-27-én levett „Ellenőrzött cég”
// jelvényt nem ígéri, nem hivatkozik nem létező GPS-naplóra, és a kódot
// „átvételi kód”-nak hívja.
describe('chatbot-tudás (gemini.js)', () => {
  const tudas = fs.readFileSync(path.join(__dirname, '..', 'src', 'services', 'gemini.js'), 'utf8');

  it('az élő GPS „hamarosan”, de nem „a mobilalkalmazással”', () => {
    expect(tudas).not.toMatch(/HAMAROSAN érkezik a GoFuvar mobilalkalmaz/);
    expect(tudas).toMatch(/ÉLŐ GPS-KÖVETÉS: HAMAROSAN/);
  });

  it('nem ígér „Ellenőrzött cég” jelvényt és GPS-naplót', () => {
    expect(tudas).not.toMatch(/badge jelenik meg/);
    expect(tudas).not.toMatch(/GPS-napló/);
  });

  it('a kódot átvételi kódnak hívja, nem PIN-nek (a tiltó utasítás kivételével)', () => {
    const pinek = tudas.match(/[^\n]*\bPIN\b[^\n]*/g) || [];
    expect(pinek.every((sor) => /ne „PIN"/.test(sor))).toBe(true);
  });
});
