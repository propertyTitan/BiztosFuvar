// =====================================================================
//  KONZOL-TISZTASÁG — néma hibák a böngészőben
//
//  Az AI felderítő tesztelő (scripts/ai-tesztelo.mjs) PASSZÍV műszere
//  találta meg, hogy a téma-kapcsoló bevezetése óta minden oldalbetöltésnél
//  React-hidratálási figyelmeztetés ment a konzolra. Semmilyen meglévő
//  tesztünk nem vette észre: a felület működött, a tesztek zöldek voltak —
//  csak épp a konzol tele volt.
//
//  Ez a spec az OSZTÁLYT őrzi: a fő oldalak betöltése ne írjon hibát vagy
//  React-figyelmeztetést a konzolra. Az ilyen zaj nem ártalmatlan — elrejti
//  a VALÓDI hibát, amit hibakereséskor keresnénk.
// =====================================================================
import { test, expect } from '@playwright/test';

const OLDALAK = ['/', '/bejelentkezes', '/hozasd-el', '/fuvarozoknak', '/aszf'];

/** Amit szándékosan elnézünk: külső/környezeti zaj, nem a mi kódunk. */
const ELNEZETT = [
  /favicon/i,
  /Download the React DevTools/i,
  /ERR_INTERNET_DISCONNECTED/i,
  // A Google Maps a teszt-kulccsal kvóta/billing figyelmeztetést írhat
  /Google Maps JavaScript API/i,
  /net::ERR_ABORTED/i,
];

test.describe('konzol-tisztaság', () => {
  for (const oldal of OLDALAK) {
    test(`nincs konzol-hiba: ${oldal}`, async ({ page }) => {
      const zaj: string[] = [];

      page.on('console', (msg) => {
        if (msg.type() !== 'error' && msg.type() !== 'warning') return;
        const szoveg = msg.text();
        if (ELNEZETT.some((r) => r.test(szoveg))) return;
        // A React hidratálási és kulcs-figyelmeztetései a leggyakoribb
        // néma hibaforrások — ezeket kifejezetten figyeljük.
        if (msg.type() === 'warning' && !/Warning:|hydrat|key|act\(/i.test(szoveg)) return;
        zaj.push(`[${msg.type()}] ${szoveg.slice(0, 300)}`);
      });

      page.on('pageerror', (err) => {
        zaj.push(`[kezeletlen kivétel] ${String(err).slice(0, 300)}`);
      });

      await page.goto(oldal, { waitUntil: 'networkidle' });
      // A hidratálás után is adunk egy pillanatot a késői figyelmeztetéseknek
      await page.waitForTimeout(800);

      expect(
        zaj,
        `A(z) ${oldal} oldal betöltése zajt írt a konzolra:\n${zaj.join('\n')}`,
      ).toEqual([]);
    });
  }
});
