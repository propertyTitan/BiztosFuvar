// =====================================================================
//  HTML-INJEKTÁLÁS A LEVELEKBE + SOCKET-KILAKOLTATÁS (2026-08-10)
//
//  Az adatáramlási audit két találata:
//
//  1) A services/email.js sablonjai szabályosan escape-elnek — a routes/-ban
//     lévő INLINE sendEmail-hívások viszont NEM. Egy szállító a saját NEVÉBE
//     tett HTML-lel (a névre csak hossz-ellenőrzés van) GoFuvar-arculatú,
//     noreply@gofuvar.hu-ról érkező levelet küldethetett a feladónak — és a
//     CÍMZETTNEK is, aki a legkiszolgáltatottabb: nincs fiókja, nem tud
//     mihez viszonyítani.
//
//  2) A `job:join` a BELÉPÉSKOR ellenőriz, de kilakoltatás nem volt. A
//     leváltott szállító nyitva hagyott füle tovább kapta az ÚJ szállító
//     élő GPS-pingjeit és fotóit.
// =====================================================================
import { describe, it, expect } from 'vitest';

const { escapeHtml } = require('../src/services/email');
const realtime = require('../src/realtime');

describe('A levelekbe kerülő felhasználói érték escape-elt', () => {
  it('a HTML-jelölés ártalmatlanná válik', () => {
    const tamado = 'Kovács J.</p><a href="https://csalo.hu">Fizesd ki a különbözetet</a><p>';
    const ki = escapeHtml(tamado);

    expect(ki, 'a támadó lezárhatta a bekezdést').not.toContain('</p>');
    expect(ki, 'a támadó linket helyezhetett a GoFuvar-levélbe').not.toContain('<a href');
    expect(ki).toContain('&lt;');
  });

  it('a képbe rejtett szkript sem megy át', () => {
    expect(escapeHtml('<img src=x onerror=alert(1)>')).not.toContain('<img');
  });

  it('a hétköznapi magyar név sértetlen marad', () => {
    expect(escapeHtml('Kovács János')).toBe('Kovács János');
  });

  it('null/undefined esetén üres string (nem „undefined" a levélben)', () => {
    expect(escapeHtml(null)).toBe('');
    expect(escapeHtml(undefined)).toBe('');
  });
});

describe('A kézbesítési e-mailek escape-elnek', () => {
  // A sablonok a routes/photos.js és routes/tracking.js fájlokban élnek,
  // inline template literálként. Forrás-szinten őrizzük, hogy a felhasználói
  // mezők ne kerülhessenek escape nélkül a HTML-be: egy új inline levél
  // írásakor ez a teszt szól, ha valaki kihagyja az esc()-et.
  const { readFileSync } = require('fs');
  const VESZELYES_MEZOK = [
    'carrier_name', 'shipper_name', 'recipient_name', 'route_title', 'full_name',
  ];

  for (const fajl of ['photos', 'tracking']) {
    it(`routes/${fajl}.js — a HTML-törzsbe csak escape-elt érték kerül`, () => {
      const forras = readFileSync(`${__dirname}/../src/routes/${fajl}.js`, 'utf8');
      // Csak a HTML-t tartalmazó sorokat nézzük (az SMS plain text — ott az
      // escape ronggyá tenné az üzenetet).
      const htmlSorok = forras.split('\n').filter((s) => /<p>|<strong>|<div/.test(s));

      for (const sor of htmlSorok) {
        for (const mezo of VESZELYES_MEZOK) {
          const nyers = new RegExp(`\\$\\{[^}]*(?<!esc\\()\\b\\w*\\.?${mezo}\\b[^}]*\\}`);
          const talalat = sor.match(nyers);
          if (talalat && !talalat[0].includes('esc(')) {
            throw new Error(
              `Escape nélküli felhasználói mező a levél HTML-törzsében `
              + `(${fajl}.js, "${mezo}"): ${talalat[0]}\n`
              + 'Használd az esc(...) helpert — enélkül a felhasználó HTML-t '
              + 'injektálhat a GoFuvar-arculatú levélbe.',
            );
          }
        }
      }
      expect(htmlSorok.length, 'nem találtam HTML-törzset — a teszt vak').toBeGreaterThan(0);
    });
  }
});

describe('Socket-kilakoltatás', () => {
  it('a függvény io nélkül is biztonságosan lefut (nem dob)', async () => {
    await expect(realtime.evictUserFromJob('valaki', 'valami')).resolves.toBeUndefined();
    await expect(realtime.evictUserFromJob(null, null)).resolves.toBeUndefined();
  });

  it('a szállító-csere meghívja a kilakoltatást', () => {
    // A `reopenJobForNewDriver` a leváltott szállítót kiteszi a fuvar
    // szobájából — enélkül a nyitva hagyott füle tovább kapná az ÚJ szállító
    // GPS-pingjeit és fotóit. Forrás-szinten őrizzük, mert a socket-szoba
    // állapotát integrációs tesztből nehéz megfigyelni.
    const { readFileSync } = require('fs');
    const forras = readFileSync(`${__dirname}/../src/routes/jobs.js`, 'utf8');
    const fn = forras.slice(
      forras.indexOf('async function reopenJobForNewDriver'),
      forras.indexOf("emitToFeed('jobs:reopened'"),
    );
    expect(
      fn,
      'a szállító-csere nem lakoltatja ki a leváltott szállítót a fuvar élő szobájából',
    ).toContain('evictUserFromJob');
  });
});
