// =====================================================================
//  KÖZÖS OLDAL-LELTÁR — egy igazságforrás minden böngészős méréshez
//
//  A leltár eredetileg a 16-oldal-lefedettseg.spec.ts-ben élt. Amikor az
//  akadálymentesítési (19) és a halott-link (20) mérés is ugyanezt az 51
//  oldalt akarta bejárni, KÉT út volt:
//    (a) mindegyik spec vezet saját listát → három lista, ami szétcsúszik,
//        és az önvédő őr csak az egyiket védi;
//    (b) egy lista, három fogyasztó.
//
//  A (b)-t választottuk. Így egy ÚJ oldal felvétele egyszerre kerül be a
//  render-, az akadálymentesítési és a link-mérésbe — és a 16-os spec
//  leltár-őre mindhármat védi: ha új page.tsx kerül az app/ alá indoklás
//  nélkül, a build piros.
//
//  ⚠️ EZ NEM SPEC-FÁJL: nincs benne test(), csak adat és fixture-építés.
// =====================================================================
import {
  createUser, createJob, loginAs, placeBid, setJobAccepted, dbQuery, E2EUser,
} from './helpers';

export type Szereplo = 'anon' | 'felado' | 'szallito' | 'admin';

export type Oldal = {
  /** Az App Router útvonala, ahogy a fájlrendszerben van (leltár-egyeztetéshez). */
  minta: string;
  /** A ténylegesen megnyitandó URL (a dinamikus paraméterek behelyettesítve). */
  url: (F: Fixtures) => string;
  szereplo: Szereplo;
  /** Ha az oldal szándékosan máshova irányít (pl. kapuzás). */
  varhatoAtiranyitas?: RegExp;
  /**
   * INTERAKCIÓVAL FELTÁRULÓ ÁLLAPOTOK (2026-08-12).
   *
   * ⚠️ Mért tapasztalat: az akadálymentesítési mérés első változata NULLA
   * sértést talált a profil szerkesztő-űrlapján — nem azért, mert jó volt,
   * hanem mert az űrlap a KEZDETI renderelésben nem is létezik (a „Személyes
   * adatok" kártya a szerkesztés-mód ágon ül). Egy szándékos regresszióval
   * lemérve: a lecsatolt címke ATTÓL SEM lett piros a mérés. Vagyis egy
   * oldalnak több ÁLLAPOTA van, és az axe csak azt látja, ami épp a DOM-ban
   * van.
   *
   * Ez a hook megnyitja a mérendő állapotot (gombra kattint, modált nyit).
   * Ha hiányzik, a kezdeti nézetet mérjük — ami a legtöbb oldalnál helyes.
   */
  allapot?: (page: import('@playwright/test').Page) => Promise<void>;
};

export type Fixtures = {
  felado: E2EUser;
  szallito: E2EUser;
  admin: E2EUser;
  jobId: string;
  licitesJobId: string;
  routeId: string;
  trackingToken: string;
};

// ── A leltár ──────────────────────────────────────────────────────────
export const OLDALAK: Oldal[] = [
  // Publikus / marketing
  { minta: '/', url: () => '/', szereplo: 'anon' },
  { minta: '/aszf', url: () => '/aszf', szereplo: 'anon' },
  { minta: '/adatkezeles', url: () => '/adatkezeles', szereplo: 'anon' },
  // Rövid átirányítás a címzetti adatkezelési szakaszra — a felvételkori
  // SMS-be ez a legrövidebb URL fér bele (GDPR 14. cikk, 2 szegmens).
  { minta: '/a', url: () => '/a', szereplo: 'anon' },
  { minta: '/bejelentkezes', url: () => '/bejelentkezes', szereplo: 'anon' },
  { minta: '/elfelejtett-jelszo', url: () => '/elfelejtett-jelszo', szereplo: 'anon' },
  { minta: '/jelszo-reset', url: () => '/jelszo-reset?token=ervenytelen', szereplo: 'anon' },
  { minta: '/email-megerositese', url: () => '/email-megerositese?token=ervenytelen', szereplo: 'anon' },
  { minta: '/fuvarozoknak', url: () => '/fuvarozoknak', szereplo: 'anon' },
  { minta: '/soforoknek', url: () => '/soforoknek', szereplo: 'anon' },
  { minta: '/webshopoknak', url: () => '/webshopoknak', szereplo: 'anon' },
  { minta: '/butorszallitas', url: () => '/butorszallitas', szereplo: 'anon' },
  { minta: '/koltoztetes', url: () => '/koltoztetes', szereplo: 'anon' },
  { minta: '/ikea-behozatal', url: () => '/ikea-behozatal', szereplo: 'anon' },
  { minta: '/marketplace-elhozas', url: () => '/marketplace-elhozas', szereplo: 'anon' },
  { minta: '/nagygep-szallitas', url: () => '/nagygep-szallitas', szereplo: 'anon' },
  { minta: '/autoszallitas', url: () => '/autoszallitas', szereplo: 'anon' },
  { minta: '/fuvar/[utvonal]', url: () => '/fuvar/budapest-szeged', szereplo: 'anon' },
  { minta: '/hozasd-el', url: () => '/hozasd-el', szereplo: 'anon' },
  { minta: '/nyomon-kovetes/[token]', url: (F) => `/nyomon-kovetes/${F.trackingToken}`, szereplo: 'anon' },

  // Mentős
  { minta: '/mentes', url: () => '/mentes', szereplo: 'felado' },
  { minta: '/mentes/regisztracio', url: () => '/mentes/regisztracio', szereplo: 'szallito' },
  { minta: '/mentes/beerkezett', url: () => '/mentes/beerkezett', szereplo: 'szallito' },

  // Közös (belépett)
  { minta: '/profil', url: () => '/profil', szereplo: 'felado' },
  {
    // Ugyanaz az útvonal, MÁSIK ÁLLAPOT: a szerkesztő-űrlap. A leltár-őr a
    // `minta` mezőre egyeztet az app/ könyvtárral, ezért a `/profil` itt
    // szándékosan ismétlődik — nem duplikátum, hanem külön mérendő állapot.
    minta: '/profil',
    url: () => '/profil',
    szereplo: 'felado',
    allapot: async (page) => {
      const gomb = page.getByRole('button', { name: /Szerkeszt/i }).first();
      await gomb.waitFor({ state: 'visible', timeout: 15_000 });
      await gomb.click();
      await page.getByText('Személyes adatok').first().waitFor({ timeout: 10_000 });
    },
  },
  { minta: '/profil/[id]', url: (F) => `/profil/${F.szallito.id}`, szereplo: 'felado' },
  { minta: '/ertesitesek', url: () => '/ertesitesek', szereplo: 'felado' },
  { minta: '/uzenetek', url: () => '/uzenetek', szereplo: 'felado' },
  { minta: '/ai-chat', url: () => '/ai-chat', szereplo: 'felado' },
  { minta: '/fuvarjaim', url: () => '/fuvarjaim', szereplo: 'felado' },
  { minta: '/hirdeteseim', url: () => '/hirdeteseim', szereplo: 'felado' },
  { minta: '/fizetes-stub', url: (F) => `/fizetes-stub?job_id=${F.jobId}`, szereplo: 'felado' },

  // Feladói
  { minta: '/dashboard', url: () => '/dashboard', szereplo: 'felado' },
  { minta: '/dashboard/uj-fuvar', url: () => '/dashboard/uj-fuvar', szereplo: 'felado' },
  { minta: '/dashboard/fuvar/[id]', url: (F) => `/dashboard/fuvar/${F.jobId}`, szereplo: 'felado' },
  { minta: '/dashboard/foglalasaim', url: () => '/dashboard/foglalasaim', szereplo: 'felado' },
  { minta: '/dashboard/utvonalak', url: () => '/dashboard/utvonalak', szereplo: 'felado' },
  { minta: '/dashboard/utvonal/[id]', url: (F) => `/dashboard/utvonal/${F.routeId}`, szereplo: 'felado' },

  // Szállítói
  { minta: '/sofor/dashboard', url: () => '/sofor/dashboard', szereplo: 'szallito' },
  { minta: '/sofor/fuvarok', url: () => '/sofor/fuvarok', szereplo: 'szallito' },
  { minta: '/sofor/fuvar/[id]', url: (F) => `/sofor/fuvar/${F.licitesJobId}`, szereplo: 'szallito' },
  { minta: '/sofor/sajat-fuvarok', url: () => '/sofor/sajat-fuvarok', szereplo: 'szallito' },
  { minta: '/sofor/licitjeim', url: () => '/sofor/licitjeim', szereplo: 'szallito' },
  { minta: '/sofor/utvonalaim', url: () => '/sofor/utvonalaim', szereplo: 'szallito' },
  { minta: '/sofor/uj-utvonal', url: () => '/sofor/uj-utvonal', szereplo: 'szallito' },
  { minta: '/sofor/utvonal/[id]', url: (F) => `/sofor/utvonal/${F.routeId}`, szereplo: 'szallito' },
  { minta: '/sofor/utvonal/[id]/utba-eso', url: (F) => `/sofor/utvonal/${F.routeId}/utba-eso`, szereplo: 'szallito' },
  { minta: '/sofor/ertesitok', url: () => '/sofor/ertesitok', szereplo: 'szallito' },
  { minta: '/sofor/visszafuvar', url: () => '/sofor/visszafuvar', szereplo: 'szallito' },

  // Admin
  { minta: '/admin', url: () => '/admin', szereplo: 'admin' },
];

/** Szándékosan kihagyott oldalak — mindegyikhez írásos indokkal. */
export const KIVETELEK: Record<string, string> = {};

/** A fixture-ök felépítése — minden mérés a SAJÁT példányát kapja, hogy a
 *  specek ne szennyezzék egymás adatait (külön user, külön fuvar). */
export async function keszitsFixtures(): Promise<Fixtures> {
  const felado = await createUser('shipper', 'Lefedettség Feladó');
  const szallito = await createUser('carrier', 'Lefedettség Szállító');
  const admin = await createUser('admin', 'Lefedettség Admin');

  // Elfogadott + fizetett fuvar (a feladói és szállítói részletoldalhoz)
  const job = await createJob(felado);
  await setJobAccepted(job.id, szallito.id, { paid: true, priceHuf: 15000 });

  // Licites fuvar (a szállítói fuvar-oldal ajánlattételi nézetéhez)
  const licites = await createJob(felado, { title: 'Licites fuvar a lefedettséghez' });
  await placeBid(szallito, licites.id, 14000);

  // Járat a szállítótól (feladói foglalási és szállítói szerkesztő nézethez)
  const { rows: routeRows } = await dbQuery(
    `INSERT INTO carrier_routes (carrier_id, title, departure_at, status, waypoints)
     VALUES ($1, 'Lefedettségi járat', NOW() + INTERVAL '2 days', 'open', $2::jsonb)
     RETURNING id`,
    [szallito.id, JSON.stringify([
      { name: 'Budapest', lat: 47.4979, lng: 19.0402, order: 0 },
      { name: 'Szeged', lat: 46.253, lng: 20.1414, order: 1 },
    ])],
  );
  const routeId = routeRows[0].id;
  await dbQuery(
    `INSERT INTO carrier_route_prices (route_id, size, price_huf)
     VALUES ($1, 'M', 9000) ON CONFLICT DO NOTHING`,
    [routeId],
  );

  const { rows: tokenRows } = await dbQuery(
    'SELECT tracking_token FROM jobs WHERE id = $1', [job.id],
  );

  return {
    felado, szallito, admin,
    jobId: job.id,
    licitesJobId: licites.id,
    routeId,
    trackingToken: tokenRows[0].tracking_token,
  };
}

export { loginAs };

/**
 * Megvárja, amíg az oldal MEGÁLLAPODIK — vagyis nincs több folyamatban lévő
 * navigáció.
 *
 * ⚠️ MIÉRT KELL (2026-08-12, CI-ban mért hiba): a `/a` egy átirányító rövid
 * URL, a `/dashboard` pedig kliens-oldalon irányít át a szerep szerinti
 * nézetre. A `networkidle` ezeknél NEM elég: közvetlenül utána még lezajlik
 * egy navigáció, és az épp futó `page.$$eval` / axe-elemzés
 * „Execution context was destroyed" hibával elszáll.
 *
 * Lokálisan végig zöld volt, a CI-ban elbukott — időzítés-függő, tehát
 * pontosan az a fajta flaky teszt, amit nem szabad a main-en hagyni.
 *
 * A 16-os render-mérés azért immunis, mert `page.locator(...).innerText()`-et
 * használ, ami automatikusan újrapróbál; a `$$eval` és az axe nem.
 */
export async function varjStabilOldalt(
  page: import('@playwright/test').Page,
  maxMs = 8000,
): Promise<void> {
  await page.waitForLoadState('networkidle').catch(() => {});

  const hatarido = Date.now() + maxMs;
  let elozo = '';
  let stabilOta = 0;

  while (Date.now() < hatarido) {
    const mostani = page.url();
    if (mostani === elozo) {
      stabilOta += 200;
      // Két egymást követő, 400 ms-on át változatlan URL: megállapodott.
      if (stabilOta >= 400) break;
    } else {
      elozo = mostani;
      stabilOta = 0;
    }
    await page.waitForTimeout(200);
  }

  // A hidratálás/átirányítás utáni utolsó renderelés befejezése.
  await page.waitForLoadState('networkidle').catch(() => {});
  await page.locator('body').waitFor({ state: 'attached', timeout: 5000 }).catch(() => {});
}
