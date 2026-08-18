// =====================================================================
//  CONSENT-LABEL: A SZÖVEG NEM ESHET ÖSSZE (2026-08-18)
//
//  A tesztelő képernyőképén a fizetési kártya consent-doboza több ezer px
//  magasra nyúlt, a jogi szöveg pedig egy ~1 karakter széles oszlopban,
//  BETŰNKÉNT TÖRVE, függőlegesen jelent meg.
//
//  ⚠️ A VALÓDI GYÖKÉROK — az első diagnózis (mobil-session) korrigálva:
//  NEM motorfüggő flex-viselkedés volt, hanem a globals.css `input { width:
//  100% }` szabálya, ami a JELÖLŐNÉGYZETET is teljes szélességűre nyújtotta.
//  A `flexShrink: 0`-s, 492 px-es checkbox az egész sort elfoglalta, a
//  szöveg-span 0-ra szorult, az `overflow-wrap: anywhere` (a .card öröklött
//  szabálya) pedig betűnként törte. Chromiumban IS reprodukálódott — itt, e
//  teszt első futásában (span: w=0, h=5460, a checkbox w=492) —, a „nem
//  reprodukálható" korábbi állítás a rossz állapotú fixture műterméke volt.
//  A többi checkbox csak azért ép, mert mind kap kézi inline `width: 20`-at.
//
//  A JAVÍTÁS három rétege: (1) a globális szabály alól a checkbox/radio
//  kivétel (osztály-javítás); (2) explicit checkbox-méret a komponensben;
//  (3) `flex: 1 1 0%` + `minWidth: 0` a szövegen. A viselkedési assertek
//  Chromiumban is mérnek — visszamérve: a (1)+(2) visszavonásával piros.
// =====================================================================
import { test, expect } from '@playwright/test';
import {
  createUser, createJob, placeBid, setJobAccepted, loginAs,
} from './helpers';

test.describe('consent-label: nem eshet össze', () => {
  test.use({ viewport: { width: 390, height: 844 } });

  test('a fizetési kártya consent-szövege kitölti a helyet (390 px-en is)', async ({ page }) => {
    const felado = await createUser('shipper', 'Consent Teszt');
    const szallito = await createUser('carrier', 'Consent Szállító');
    const job = await createJob(felado);
    await placeBid(szallito, job.id, 14000);
    // Elfogadott, de MÉG NEM fizetett fuvar — ezen látszik a consent-doboz.
    await setJobAccepted(job.id, szallito.id, { paid: false, priceHuf: 14000 });

    await loginAs(page, felado);
    await page.goto(`/dashboard/fuvar/${job.id}`);

    const szoveg = page.getByTestId('fee-consent-szoveg');
    await expect(szoveg).toBeVisible();

    // 1) A DETERMINISZTIKUS STÍLUS — ez a tényleges javítás. Motorfüggetlen
    //    mérés: ha valaki kiveszi, itt azonnal piros, akkor is, ha a CI
    //    motorján a tünet nem látszik.
    const stilus = await szoveg.evaluate((el) => {
      const cs = window.getComputedStyle(el);
      return { flexGrow: cs.flexGrow, flexBasis: cs.flexBasis, minWidth: cs.minWidth };
    });
    expect(
      stilus.flexGrow,
      'A consent-szöveg span-járól eltűnt a `flex: 1 1 0%`. Enélkül a span\n'
      + 'szélessége a TARTALOM min-szélességéből számolódik, amit a kártya\n'
      + '`overflow-wrap: anywhere` szabálya ~1 karakterre ejt — egyes\n'
      + 'böngésző-motorokon a jogi szöveg betűnként, függőlegesen törik\n'
      + '(tesztelői képernyőkép, 2026-08-18). A CI Chromiuma ezt NEM\n'
      + 'reprodukálja — ezért méri az őr a stílust, nem csak a tünetet.',
    ).toBe('1');
    expect(stilus.minWidth, 'a `minWidth: 0` eltűnt a consent-szöveg span-járól').toBe('0px');

    // 2) JÓZANSÁGI HATÁROK — minden motoron igaznak kell lenniük.
    const meret = await szoveg.boundingBox();
    expect(meret, 'a consent-szöveg nem renderelődött').not.toBeNull();
    expect(
      meret!.width,
      `A consent-szöveg oszlopa ${Math.round(meret!.width)} px széles — a\n`
      + 'betűnkénti függőleges törés jele. 390 px-es nézetben a szövegnek a\n'
      + 'kártya szélességének nagy részét ki kell töltenie.',
    ).toBeGreaterThan(200);
    expect(
      meret!.height,
      `A consent-doboz ${Math.round(meret!.height)} px magas — összeesett\n`
      + 'szélességre utal (a szöveg függőlegesen törik).',
    ).toBeLessThan(220);
  });

  test('a FOGLALÁS-ági consent-label ugyanaz a komponens (nincs második, javítatlan másolat)', async ({ page }) => {
    // A markup korábban KÉT helyen élt duplikálva — a fuvar-ágon javított
    // hiba a foglalás-ágon megmaradt volna. A közös komponens után elég a
    // forrást őrizni: a Bookings a FeeConsentLabel-t rendereli, nem sajátot.
    // (Fixture-rel a foglalási fizetőkártya kirenderelése aránytalanul drága
    // lenne ehhez képest — a forrás-szintű őr itt elégséges, mert az 1. teszt
    // már méri magát a komponenst.)
    const fs = await import('node:fs');
    const path = await import('node:path');
    const forras = fs.readFileSync(
      path.join(__dirname, '..', 'src', 'components', 'fuvarjaim', 'Bookings.tsx'),
      'utf8',
    );
    expect(
      forras.includes('FeeConsentLabel'),
      'A Bookings.tsx már nem a közös FeeConsentLabel-t használja — a\n'
      + 'consent-markup megint duplikálódik, és a következő javítás megint\n'
      + 'csak az egyik oldalon fog megépülni.',
    ).toBe(true);
    expect(
      /Kérem a szolgáltatás \(kapcsolatfelvételi adatok átadása\)/.test(forras),
      '',
    ).toBe(false);
    // A teszt „page” paramétere szándékosan kihasználatlan — a describe-szintű
    // viewport-beállítás miatt van jelen.
    void page;
  });
});
