// =====================================================================
//  OLDAL-LEFEDETTSÉG — a felület MINDEN oldala megnyílik és renderel
//
//  Az API-oldalon már mértünk és lezártuk a rést (backend
//  szerep-lefedettseg.test.js: minden végpontra fut sikeres hívás). A
//  BÖNGÉSZŐS oldalon viszont sokáig csak a fő flow-k voltak végigkattintva:
//  a 47 oldalból az E2E ~11-et látott. Ha egy oldal fehéren elszáll — rossz
//  import, null-ra hivatkozás, elrontott hook —, azt semmilyen API-teszt nem
//  veszi észre, mert a backend rendben válaszol.
//
//  Ez a spec MINDEN oldalt megnyit a hozzá tartozó szereplővel, és azt
//  ellenőrzi, ami minden oldalra igaz kell legyen:
//    1. a dokumentum betöltődik (nem 4xx/5xx)
//    2. nincs kezeletlen JS-kivétel és nincs konzol-hiba
//    3. tényleg renderelt tartalom (nem üres, nem a 404-oldal)
//    4. nem látszik nyers hibaállapot („Szerverhiba", „Something went wrong")
//
//  ⚠️ ÖNVÉDŐ: az utolsó teszt elhasal, ha új oldal kerül az app/ alá, ami
//  nincs felvéve a leltárba — és nincs rá írásos indok. Így a böngészős
//  lefedettség nem tud némán visszacsúszni, ahogy az API-nál sem.
// =====================================================================
import { test, expect, Page } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';
import {
  createUser, createJob, loginAs, placeBid, setJobAccepted, dbQuery, E2EUser,
} from './helpers';

// ── Ami zajnak számít, nem hibának ────────────────────────────────────
const ELNEZETT_KONZOL = [
  /favicon/i,
  /Download the React DevTools/i,
  /ERR_INTERNET_DISCONNECTED/i,
  /Google Maps JavaScript API/i,
  /net::ERR_ABORTED/i,
  // A térkép-komponens kulcs nélkül/kvótával panaszkodhat — nem a mi hibánk
  /googleapis\.com/i,
  // A böngésző konzol-HIBAKÉNT naplózza a 4xx válaszokat is — pedig azok
  // NORMÁLIS alkalmazás-működés: érvénytelen email-token → 400, nem a saját
  // fuvaram részlete → 403. Az app ezeket lekezeli és hibaállapotot mutat.
  // Az 5xx-et SZÁNDÉKOSAN NEM nézzük el: az valódi szerver-összeomlás.
  /Failed to load resource.*status of 4\d\d/i,
];

/** Nyers hibaállapotok, amiknek sosem szabad a felületen megjelenniük. */
const HIBA_JELEK = [
  /Szerverhiba/i,
  /Something went wrong/i,
  /Application error/i,
  /Unhandled Runtime Error/i,
  /TypeError:/,
  /Cannot read propert/i,
];

type Szereplo = 'anon' | 'felado' | 'szallito' | 'admin';

type Oldal = {
  /** Az App Router útvonala, ahogy a fájlrendszerben van (leltár-egyeztetéshez). */
  minta: string;
  /** A ténylegesen megnyitandó URL (a dinamikus paraméterek behelyettesítve). */
  url: (F: Fixtures) => string;
  szereplo: Szereplo;
  /** Ha az oldal szándékosan máshova irányít (pl. kapuzás). */
  varhatoAtiranyitas?: RegExp;
};

type Fixtures = {
  felado: E2EUser;
  szallito: E2EUser;
  admin: E2EUser;
  jobId: string;
  licitesJobId: string;
  routeId: string;
  trackingToken: string;
};

// ── A leltár ──────────────────────────────────────────────────────────
const OLDALAK: Oldal[] = [
  // Publikus / marketing
  { minta: '/', url: () => '/', szereplo: 'anon' },
  { minta: '/aszf', url: () => '/aszf', szereplo: 'anon' },
  { minta: '/adatkezeles', url: () => '/adatkezeles', szereplo: 'anon' },
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
  { minta: '/profil/[id]', url: (F) => `/profil/${F.szallito.id}`, szereplo: 'felado' },
  { minta: '/ertesitesek', url: () => '/ertesitesek', szereplo: 'felado' },
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
const KIVETELEK: Record<string, string> = {};

// ── Fixture-ök (egyszer, az egész specre) ─────────────────────────────
let F: Fixtures;

test.beforeAll(async () => {
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

  F = {
    felado, szallito, admin,
    jobId: job.id,
    licitesJobId: licites.id,
    routeId,
    trackingToken: tokenRows[0].tracking_token,
  };
});

/** Az oldal megnyitása a megfelelő szereplővel + a közös ellenőrzések. */
async function ellenorizOldalt(page: Page, oldal: Oldal) {
  const zaj: string[] = [];
  page.on('console', (msg) => {
    if (msg.type() !== 'error') return;
    const szoveg = msg.text();
    if (ELNEZETT_KONZOL.some((r) => r.test(szoveg))) return;
    zaj.push(`[konzol] ${szoveg.slice(0, 200)}`);
  });
  page.on('pageerror', (err) => {
    zaj.push(`[kezeletlen kivétel] ${String(err).slice(0, 200)}`);
  });

  const user = oldal.szereplo === 'anon' ? null
    : oldal.szereplo === 'felado' ? F.felado
    : oldal.szereplo === 'szallito' ? F.szallito
    : F.admin;
  if (user) await loginAs(page, user);

  const cel = oldal.url(F);
  const valasz = await page.goto(cel, { waitUntil: 'domcontentloaded' });

  // 1. A dokumentum betöltődött
  expect(valasz?.status(), `${cel} → HTTP ${valasz?.status()}`).toBeLessThan(400);

  // A kliens-oldali adatlekérés és a hidratálás befejeződjön
  await page.waitForLoadState('networkidle').catch(() => {});
  await page.waitForTimeout(600);

  const torzs = await page.locator('body').innerText();

  // 2. Nincs kezeletlen kivétel / konzol-hiba
  expect(zaj, `${cel} — JS-hiba az oldalon:\n${zaj.join('\n')}`).toEqual([]);

  // 3. Renderelt tartalom (a fejléc+lábléc önmagában kevés lenne)
  expect(
    torzs.replace(/\s+/g, ' ').trim().length,
    `${cel} — az oldal gyakorlatilag üresen jött vissza`,
  ).toBeGreaterThan(120);

  // 4. Nincs nyers hibaállapot a képernyőn
  for (const jel of HIBA_JELEK) {
    expect(
      jel.test(torzs),
      `${cel} — nyers hibaállapot látszik a felületen (${jel}):\n` +
      torzs.slice(0, 300),
    ).toBe(false);
  }

  // 5. Nem a 404-oldalon kötöttünk ki (kivéve ha ezt vártuk)
  //
  // ⚠️ A puszta „404" sztringre NEM szabad illeszteni: az oldalakon vannak
  // véletlen 6 jegyű számok (átvételi PIN), és egy „548404" kódra a teszt
  // lebegett — ez élesben is előjött. Az app/not-found.tsx valódi
  // címsoraira szűrünk helyette, ami egyértelmű.
  if (!oldal.varhatoAtiranyitas) {
    const negyszaznegyes = /Az oldal nem található|Másik mód szükséges/.test(torzs);
    expect(negyszaznegyes, `${cel} — a 404-oldalra futott`).toBe(false);
  }
}

// ── A tesztek ─────────────────────────────────────────────────────────
test.describe('oldal-lefedettség: minden oldal megnyílik és renderel', () => {
  for (const oldal of OLDALAK) {
    test(`${oldal.minta} (${oldal.szereplo})`, async ({ page }) => {
      await ellenorizOldalt(page, oldal);
    });
  }
});

// ── Az őr ─────────────────────────────────────────────────────────────
test.describe('oldal-leltár őr', () => {
  test('minden app/ alatti oldal szerepel a leltárban', async () => {
    const appDir = path.join(process.cwd(), 'app');
    const talalt: string[] = [];
    const bejar = (dir: string) => {
      for (const bejegyzes of fs.readdirSync(dir, { withFileTypes: true })) {
        const teljes = path.join(dir, bejegyzes.name);
        if (bejegyzes.isDirectory()) bejar(teljes);
        else if (bejegyzes.name === 'page.tsx') {
          const utvonal = '/' + path.relative(appDir, dir).split(path.sep).join('/');
          talalt.push(utvonal === '/.' ? '/' : utvonal);
        }
      }
    };
    bejar(appDir);

    const leltarban = new Set(OLDALAK.map((o) => o.minta));
    const hianyzik = talalt.filter((u) => !leltarban.has(u) && !KIVETELEK[u]);
    expect(
      hianyzik,
      'ÚJ OLDAL A LELTÁRON KÍVÜL — nincs rá böngészős ellenőrzés.\n' +
      'Vedd fel az OLDALAK listába a szereplővel együtt, vagy a KIVETELEK közé INDOKKAL:\n' +
      hianyzik.map((u) => `  { minta: '${u}', url: () => '${u}', szereplo: 'anon' },`).join('\n'),
    ).toEqual([]);

    // A leltár se hivatkozzon már nem létező oldalra
    const talaltSet = new Set(talalt);
    const elavult = OLDALAK.map((o) => o.minta).filter((u) => !talaltSet.has(u));
    expect(elavult, `A leltárban nem létező oldal szerepel: ${elavult.join(', ')}`).toEqual([]);
  });
});
