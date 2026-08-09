// =====================================================================
//  A CÍMZETT GDPR 14. CIKK SZERINTI TÁJÉKOZTATÁSA
//
//  Audit-találat (2026-08-09, 2. kör, KRITIKUS). A címzett a rendszer
//  egyetlen olyan érintettje, aki SOHA nem lépett kapcsolatba velünk: az
//  adatait a feladó adja meg, nincs fiókja, nem fogadott el semmit — mégis
//  kap tőlünk SMS-t és e-mailt, és a nevét, telefonszámát, e-mail-címét és a
//  lakcímét tároljuk.
//
//  A 14. cikk épp erre az esetre ír elő tájékoztatást: ki az adatkezelő,
//  honnan van az adat, meddig tartjuk meg, hogyan tiltakozhat. Ezekből
//  2026-08-09-ig EGYETLEN elem sem szerepelt sehol — sem az e-mailben, sem a
//  követő-oldalon, sem a tájékoztatóban (ami végig „Felhasználó"-ról beszél,
//  és a beazonosításhoz a REGISZTRÁCIÓS e-mail-címet kéri, amivel a címzett
//  definíció szerint nem rendelkezik).
//
//  Ez a suite azt őrzi, hogy a tájékoztatás ne kophasson ki a sablonokból.
// =====================================================================
import { describe, it, expect, vi, afterEach } from 'vitest';

const email = require('../src/services/email');

afterEach(() => { vi.restoreAllMocks(); });

/** Elkapja a ténylegesen összeállított HTML-t (a küldés stub módban van). */
async function elkapottHtml(kuldes) {
  let html = null;
  const eredeti = console.log;
  vi.spyOn(console, 'log').mockImplementation(() => {});
  // A sendEmail stub-ágon nem adja vissza a HTML-t, ezért a fetch helyett a
  // sablon-építőt hívjuk közvetetten: a wrapHtml-t használó függvények
  // kimenetét a modul nem exportálja, így a küldést figyeljük meg.
  const fetchSpy = vi.fn(async () => ({ ok: true, json: async () => ({ id: 'x' }) }));
  vi.stubGlobal('fetch', fetchSpy);
  process.env.RESEND_API_KEY = 'teszt-kulcs';
  try {
    await kuldes();
    const body = fetchSpy.mock.calls[0]?.[1]?.body;
    html = body ? JSON.parse(body).html : null;
  } finally {
    process.env.RESEND_API_KEY = '';
    vi.unstubAllGlobals();
    console.log = eredeti;
  }
  return html || '';
}

describe('A címzettnek küldött e-mail tájékoztatása', () => {
  it('megnevezi az adatkezelőt, és nem csak a „GoFuvar" márkanevet', async () => {
    const html = await elkapottHtml(() => email.sendRecipientTrackingEmail({
      to: 'cimzett@pelda.hu',
      recipientName: 'Kovács Anna',
      jobTitle: 'Kanapé',
      trackingUrl: 'https://gofuvar.hu/nyomon-kovetes/abc',
      deliveryCode: '123456',
    }));

    expect(html, 'nem sikerült elkapni a levél tartalmát').toBeTruthy();
    expect(html, 'az adatkezelő cégneve hiányzik (GDPR 14. cikk)').toContain('Tiszta Hód Kft.');
    expect(html, 'az adatkezelési tájékoztató linkje hiányzik').toContain('/adatkezeles');
  });

  it('elmondja, HONNAN van az adata, és MEDDIG tartjuk meg', async () => {
    const html = await elkapottHtml(() => email.sendRecipientTrackingEmail({
      to: 'cimzett@pelda.hu', recipientName: 'Kovács Anna', jobTitle: 'Kanapé',
      trackingUrl: 'https://gofuvar.hu/nyomon-kovetes/abc', deliveryCode: '123456',
    }));

    expect(html, 'nem derül ki, kitől kaptuk az adatot').toMatch(/feladó/i);
    expect(html, 'nem derül ki a megőrzési idő').toMatch(/töröljük|lezárás/i);
  });

  it('megadja a tiltakozás/törlés útját', async () => {
    const html = await elkapottHtml(() => email.sendRecipientTrackingEmail({
      to: 'cimzett@pelda.hu', recipientName: 'Kovács Anna', jobTitle: 'Kanapé',
      trackingUrl: 'https://gofuvar.hu/nyomon-kovetes/abc', deliveryCode: '123456',
    }));
    expect(html).toContain('info@gofuvar.hu');
  });

  it('NEM ígér élő GPS-követést (az csak a mobil-fázisban lesz)', async () => {
    const html = await elkapottHtml(() => email.sendRecipientTrackingEmail({
      to: 'cimzett@pelda.hu', recipientName: 'Kovács Anna', jobTitle: 'Kanapé',
      trackingUrl: 'https://gofuvar.hu/nyomon-kovetes/abc', deliveryCode: '123456',
    }));
    expect(html, 'a levél élő pozíció-követést ígér, ami a webes fázisban nem létezik')
      .not.toMatch(/szállító pozícióját|követése élőben/i);
  });
});

describe('A tranzakciós e-mailek közös lába', () => {
  it('minden levélben megnevezi az adatkezelőt és a tájékoztatót', async () => {
    const html = await elkapottHtml(() => email.sendPasswordResetEmail({
      to: 'user@pelda.hu', fullName: 'Teszt Elek', resetUrl: 'https://gofuvar.hu/jelszo-reset?token=x',
    }));
    expect(html).toContain('Tiszta Hód Kft.');
    expect(html).toContain('/adatkezeles');
  });
});
