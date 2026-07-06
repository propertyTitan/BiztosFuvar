// Landing-oldalak adat-modellje.
//
// Minden kattintható marketing/SEO-oldal EGY adatból generálódik, egy közös
// sablonnal (LandingTemplate). Három típus: útvonal (route), célközönség
// (persona), használati eset (usecase). Új oldal = új bejegyzés ide, a
// megjelenítést nem kell írni.

export type LandingBullet = { icon?: string; title: string; desc: string };
export type FAQItem = { q: string; a: string };
export type LandingCTA = { label: string; href: string };

export type LandingConfig = {
  slug: string;
  kind: 'route' | 'persona' | 'usecase';
  /** Rövid címke a footer/nav linkekhez. */
  navLabel: string;
  metaTitle: string;
  metaDescription: string;
  eyebrow?: string;
  headline: string;
  subhead: string;
  primaryCta: LandingCTA;
  bullets: LandingBullet[];
  faq?: FAQItem[];
  /** Csak útvonal-oldalnál: a zöld/ár blokkhoz. */
  route?: { fromCity: string; toCity: string; distanceKm: number };
};

const REGISTER_CTA: LandingCTA = { label: 'Kezdd el ingyen', href: '/bejelentkezes?mode=register' };

// ─────────────────────────── ÚTVONAL-OLDALAK ───────────────────────────
// A "Top 5" magyar útvonal (CLAUDE.md marketing-stratégia). Közúti táv km-ben.
const ROUTES: { slug: string; from: string; to: string; km: number }[] = [
  { slug: 'budapest-szeged', from: 'Budapest', to: 'Szeged', km: 170 },
  { slug: 'budapest-debrecen', from: 'Budapest', to: 'Debrecen', km: 230 },
  { slug: 'budapest-pecs', from: 'Budapest', to: 'Pécs', km: 200 },
  { slug: 'budapest-miskolc', from: 'Budapest', to: 'Miskolc', km: 180 },
  { slug: 'budapest-gyor', from: 'Budapest', to: 'Győr', km: 120 },
];

function routeConfig(r: { slug: string; from: string; to: string; km: number }): LandingConfig {
  const title = `${r.from}–${r.to}`;
  return {
    slug: r.slug,
    kind: 'route',
    navLabel: title,
    metaTitle: `Fuvar ${title} — csomagküldés és költöztetés | GoFuvar`,
    metaDescription: `Küldj csomagot vagy bútort ${title} útvonalon megbízható sofőrökkel. Fotó + 6 jegyű átvételi kód, készpénzes fuvardíj, KYC-ellenőrzött sofőrök. Add fel pár perc alatt.`,
    eyebrow: 'Útvonal',
    headline: `Fuvar ${title}`,
    subhead: `Csomag, bútor vagy bármi, ami elfér egy autóban — vidd el ${title} útvonalon egy sofőrrel, aki úgyis arra megy. Meglévő út, tisztességes ár, biztonságos átadás.`,
    primaryCta: { label: 'Adj fel egy fuvart', href: '/bejelentkezes?mode=register' },
    route: { fromCity: r.from, toCity: r.to, distanceKm: r.km },
    bullets: [
      { icon: '🌿', title: 'Zöld, mert meglévő úton megy', desc: `A sofőr úgyis megy ${title} — a csomagod egy meglévő útra kerül, nincs plusz jármű, nincs plusz károsanyag.` },
      { icon: '📸', title: 'Fotó + 6 jegyű kód', desc: 'A sofőr felvételkor és átadáskor is fotózza a csomagot, a kézbesítést pedig egy 6 jegyű átvételi kód zárja le.' },
      { icon: '🛡️', title: 'Ellenőrzött sofőrök', desc: 'Minden sofőr átmegy a személyazonosság-ellenőrzésen (KYC), mielőtt fuvart vállalhat.' },
      { icon: '💵', title: 'Készpénzes fuvardíj', desc: 'A fuvardíjat készpénzben adod a sofőrnek; a GoFuvar csak egy kis kapcsolatfelvételi díjat szed elfogadáskor.' },
    ],
    faq: [
      { q: `Mennyibe kerül egy ${title} fuvar?`, a: 'A fuvardíjat a sofőrrel egyeztetitek — feladáskor az okos árazó ad egy ajánlott sávot a távolság, súly és méret alapján. A GoFuvar ezen felül egy sávos, bevezető kapcsolatfelvételi díjat számít (500–3 990 Ft), amit a fuvar elfogadásakor fizetsz.' },
      { q: 'Mennyi idő alatt indul?', a: 'Amint egy sofőr elfogadja a fuvart és kifizeted a kapcsolatfelvételi díjat, megkapjátok egymás elérhetőségét, és egyeztethettek időpontot.' },
      { q: 'Mit küldhetek?', a: 'Bármit, ami elfér egy autóban és jogszerű. Speciális áruhoz (pl. élő állat, gyógyszer) neked kell ellenőrizned a sofőr engedélyét.' },
    ],
  };
}

// ─────────────────────────── CÉLKÖZÖNSÉG-OLDALAK ───────────────────────────
const PERSONAS: LandingConfig[] = [
  {
    slug: 'soforoknek',
    kind: 'persona',
    navLabel: 'Sofőröknek',
    metaTitle: 'Keress a meglévő útjaiddal — legyél GoFuvar sofőr',
    metaDescription: 'Úgyis mész A-ból B-be? Vállalj fuvart az útvonaladon, és keresd meg az utad üzemanyagának árát — sőt, jóval többet. Készpénzes fuvardíj, te választod a fuvart.',
    eyebrow: 'Sofőröknek',
    headline: 'Az utaidat pénzzé teszed',
    subhead: 'Ha úgyis mész valahová, vigyél magaddal egy csomagot az útvonaladon. A fuvardíjból megkeresed az üzemanyagod árát — és jóval többet. Te döntöd el, melyik fuvart vállalod.',
    primaryCta: { label: 'Regisztrálj sofőrként', href: '/bejelentkezes?mode=register' },
    bullets: [
      { icon: '⛽', title: 'Megkeresed az üzemanyagod', desc: 'Egy meglévő úton, amit amúgy is megtennél, a fuvardíj bőven fedezi az üzemanyagot — a többi tiszta kereset.' },
      { icon: '🗺️', title: 'Útvonal-figyelő', desc: 'Állítsd be a szokásos útvonaladat, és e-mailben szólunk, amikor illő fuvar kerül ki rá.' },
      { icon: '↩️', title: 'Visszafuvar', desc: 'Ne térj vissza üresen: a rendszer felajánlja a visszaútra eső fuvarokat is.' },
      { icon: '💵', title: 'Készpénz, azonnal', desc: 'A fuvardíjat a feladótól készpénzben kapod, levonás nélkül — a GoFuvar a fuvardíjhoz nem nyúl.' },
    ],
    faq: [
      { q: 'Kell hozzá vállalkozás?', a: 'A saját adóügyi státuszodért te felelsz (rendszeres kereső tevékenységhez a magyar jog szerint általában vállalkozói forma kell). A GoFuvar a fuvardíjat nem kezeli és nem számlázza — az a te és a feladó közti készpénzes ügylet.' },
      { q: 'Hogyan kezdjek?', a: 'Regisztrálj, menj át a személyazonosság-ellenőrzésen (KYC), töltsd fel a jogosítványod, és már licitálhatsz is a fuvarokra.' },
      { q: 'Én választom a fuvart?', a: 'Igen. Te böngészed a fuvarokat, te adsz ajánlatot, és csak azt vállalod, ami neked megéri.' },
    ],
  },
  {
    slug: 'webshopoknak',
    kind: 'persona',
    navLabel: 'Webshopoknak',
    metaTitle: 'Rugalmas kiszállítás webshopoknak és marketplace-eladóknak | GoFuvar',
    metaDescription: 'Nagy vagy terjedelmes termék, amit a futárszolgálat nehezen visz? Kínálj a vásárlóidnak GoFuvar-kiszállítást: ellenőrzött sofőrök, fotó + kód, céges számla.',
    eyebrow: 'Webshopoknak',
    headline: 'Kiszállítás, ami a terjedelmes termékre is jó',
    subhead: 'Bútor, nagy doboz, több darab? A GoFuvar sofőrök oda viszik, ahová a szokásos futár nehezen. Céges fiókkal, számlával, ellenőrzött sofőrökkel.',
    primaryCta: { label: 'Hozz létre céges fiókot', href: '/bejelentkezes?mode=register' },
    bullets: [
      { icon: '📦', title: 'Terjedelmes áru is', desc: 'Nem méret-korlátos futárcsomag: bármi, ami elfér egy autóban vagy furgonban.' },
      { icon: '🧾', title: 'Céges fiók + számla', desc: 'Adószámmal regisztrálsz, a kapcsolatfelvételi díjról számlát kapsz.' },
      { icon: '🛡️', title: 'Ellenőrzött sofőrök', desc: 'KYC-ellenőrzött sofőrök, fotó a felvételről és az átadásról, 6 jegyű átvételi kód.' },
      { icon: '🌿', title: 'Zöldebb kiszállítás', desc: 'A csomag meglévő úton utazik — kevesebb kibocsátás, amit a vásárlóidnak is kommunikálhatsz.' },
    ],
    faq: [
      { q: 'Hogyan integrálom a boltomba?', a: 'Induláskor manuális feladással működik (pár perc/rendelés). A webshop-integráció a roadmapen van — jelezd az igényt, és előre veszünk.' },
      { q: 'Kapok számlát?', a: 'Igen, a kapcsolatfelvételi díjról a céges adataiddal kiállított számlát kapsz.' },
    ],
  },
];

// ─────────────────────────── HASZNÁLATI ESET OLDALAK ───────────────────────────
const USECASES: LandingConfig[] = [
  {
    slug: 'butorszallitas',
    kind: 'usecase',
    navLabel: 'Bútorszállítás',
    metaTitle: 'Bútorszállítás olcsón és biztonságosan | GoFuvar',
    metaDescription: 'Kanapé, szekrény, ágy — vidd el egy sofőrrel, aki úgyis arra megy. A sofőrök versenye miatt gyakran kedvező áron, és a csomagot fotó + 6 jegyű kód védi.',
    eyebrow: 'Bútorszállítás',
    headline: 'Bútort vinnél? Van rá sofőr',
    subhead: 'Egy kanapé, egy szekrény, egy marketplace-en vett asztal — a GoFuvar sofőrök elviszik. A sofőrök ajánlatot tesznek rá, te a neked megfelelőt választod — a verseny miatt gyakran kedvező áron.',
    primaryCta: REGISTER_CTA,
    bullets: [
      { icon: '🛋️', title: 'Nagy darab is elfér', desc: 'Nem futárcsomag-méret: bútor, több darab, terjedelmes tárgy — ami befér egy autóba vagy furgonba.' },
      { icon: '💪', title: 'Bepakolás jelölhető', desc: 'Feladáskor jelezheted, ha emeletre kell felvinni vagy segítség kell a pakoláshoz.' },
      { icon: '📸', title: 'Fotó + kód védelem', desc: 'A sofőr fotózza a bútort felvételkor és átadáskor, a kézbesítést 6 jegyű kód zárja.' },
      { icon: '💵', title: 'A sofőr ajánl, te döntesz', desc: 'A sofőrök árajánlatot tesznek a fuvarodra; te a neked megfelelőt elfogadod, vagy ellenajánlatot teszel. Az okos árazó segít belőni a reális sávot.' },
    ],
    faq: [
      { q: 'Mennyibe kerül a bútorszállítás?', a: 'Feladáskor az okos árazó ad egy ajánlott sávot a távolság, súly és méret alapján; a sofőrök erre tesznek árajánlatot, te pedig a neked megfelelőt elfogadod. A GoFuvar egy sávos kapcsolatfelvételi díjat számít az elfogadáskor.' },
      { q: 'Felviszik az emeletre?', a: 'Ha a feladásnál jelzed a bepakolási igényt (emelet, lift), a sofőr ezt előre látja és beárazza.' },
    ],
  },
  {
    slug: 'ikea-behozatal',
    kind: 'usecase',
    navLabel: 'IKEA-behozatal',
    metaTitle: 'IKEA, OBI, Praktiker behozatal — hozasd el a vásárlásod | GoFuvar',
    metaDescription: 'Megvan a termék linkje, de nincs mivel elhozni? Másold be, és egy sofőr elhozza az IKEA/OBI/Praktiker/Jófogás vásárlásod. A sofőrök versenye miatt gyakran kedvező áron.',
    eyebrow: 'Hozasd el',
    headline: 'Megvetted — hozasd el',
    subhead: 'IKEA, OBI, Praktiker, Jófogás: másold be a termék linkjét, mi kiolvassuk a méretet és a képet, egy sofőr pedig elhozza neked. Rugalmas, és a sofőrök versenye miatt gyakran kedvező áron.',
    primaryCta: { label: 'Hozasd el most', href: '/hozasd-el' },
    bullets: [
      { icon: '🔗', title: 'Csak a link kell', desc: 'Bemásolod a termék linkjét, mi előnézetet csinálunk (cím + kép), és előtöltjük a fuvart.' },
      { icon: '🚚', title: 'A sofőr elhozza', desc: 'Egy sofőr, aki úgyis arra jár, felveszi a boltból és házhoz viszi.' },
      { icon: '📸', title: 'Fotó + kód', desc: 'Ugyanaz a védelem, mint minden fuvarnál: fotó a felvételről és az átadásról, 6 jegyű kód.' },
      { icon: '💰', title: 'Versenyző árak', desc: 'Több sofőr licitál a fuvarra, és egy meglévő útra pakolva az ár gyakran kedvező.' },
    ],
    faq: [
      { q: 'Mely boltok támogatottak?', a: 'IKEA, OBI, Praktiker, Jófogás termék-linkek előnézetét olvassuk ki. Más boltból a fuvart kézzel is feladhatod.' },
      { q: 'Honnan tudja a sofőr, mit hozzon?', a: 'A termék képe és adatai a sofőrhöz is eljutnak, így pontosan tudja, mit vegyen fel.' },
    ],
  },
  {
    slug: 'koltoztetes',
    kind: 'usecase',
    navLabel: 'Költöztetés',
    metaTitle: 'Költöztetés olcsón — kis költözés sofőrrel | GoFuvar',
    metaDescription: 'Albérlet-váltás, néhány bútor és doboz? Vidd el egy sofőrrel, aki úgyis arra megy. A sofőrök versenye miatt gyakran kedvező áron, fotó + 6 jegyű átvételi kód.',
    eyebrow: 'Költöztetés',
    headline: 'Költözöl? Nem kell hozzá teljes költöztető cég',
    subhead: 'Egy albérlet-váltás, pár bútor és néhány doboz — a GoFuvar sofőrök rugalmasan elviszik. A sofőrök ajánlatot tesznek rá, te a neked megfelelőt választod — a verseny miatt gyakran kedvező áron.',
    primaryCta: { label: 'Add fel a költözésed', href: '/bejelentkezes?mode=register' },
    bullets: [
      { icon: '📦', title: 'Bútor és doboz egyben', desc: 'Nem futárcsomag-méret: bútor, dobozok, terjedelmes tárgyak — ami befér egy autóba vagy furgonba.' },
      { icon: '💪', title: 'Bepakolás, emelet jelölhető', desc: 'Feladáskor jelezheted, ha emeletre kell felvinni vagy segítség kell a pakoláshoz — a sofőr előre látja.' },
      { icon: '🛡️', title: 'Ellenőrzött sofőrök, fotó + kód', desc: 'KYC-ellenőrzött sofőrök, fotó a felvételről és az átadásról, 6 jegyű átvételi kód.' },
      { icon: '💵', title: 'A sofőr ajánl, te döntesz', desc: 'A sofőrök árajánlatot tesznek a fuvarodra; te a neked megfelelőt elfogadod, vagy ellenajánlatot teszel. Az okos árazó segít belőni a reális sávot.' },
    ],
    faq: [
      { q: 'Mennyibe kerül egy kis költözés?', a: 'Feladáskor az okos árazó ad egy ajánlott sávot a távolság, súly és méret alapján; a sofőrök erre tesznek árajánlatot, te pedig a neked megfelelőt elfogadod. A GoFuvar egy sávos kapcsolatfelvételi díjat számít az elfogadáskor.' },
      { q: 'Nagyobb költözésre is jó?', a: 'Ami elfér egy autóban vagy furgonban, azt egy fuvarral; nagyobb mennyiséget több fordulóval vagy nagyobb járművű sofőrrel. A feladásnál jelöld a méretet, hogy a megfelelő sofőr vállalja.' },
    ],
  },
  {
    slug: 'nagygep-szallitas',
    kind: 'usecase',
    navLabel: 'Nagygép-szállítás',
    metaTitle: 'Mosógép, hűtő szállítás — nagygép elvitele | GoFuvar',
    metaDescription: 'Mosógép, hűtő, mosogatógép, szárítógép elvitele egy sofőrrel furgonnal. A sofőrök versenye miatt gyakran kedvező áron, fotó + 6 jegyű átvételi kód.',
    eyebrow: 'Nagygép-szállítás',
    headline: 'Mosógép, hűtő? Van rá sofőr furgonnal',
    subhead: 'Nagy háztartási gép, ami nem fér a kocsidba? Egy GoFuvar sofőr furgonnal elviszi. A sofőrök licitálnak rá, te a neked megfelelőt fogadod el — a verseny miatt gyakran kedvező áron.',
    primaryCta: { label: 'Add fel a szállítást', href: '/bejelentkezes?mode=register' },
    bullets: [
      { icon: '🧺', title: 'Nagygép is elfér', desc: 'Mosógép, hűtő, mosogatógép, szárítógép — furgonos sofőr elviszi.' },
      { icon: '💪', title: 'Bepakolás, emelet jelölhető', desc: 'Ha emeletre kell felvinni vagy segítség kell, jelöld a feladásnál — a sofőr beárazza.' },
      { icon: '📸', title: 'Fotó + 6 jegyű kód', desc: 'A gépet a sofőr felvételkor és átadáskor is fotózza, a kézbesítést kód zárja.' },
      { icon: '💵', title: 'A sofőr ajánl, te döntesz', desc: 'A sofőrök árajánlatot tesznek; te a neked megfelelőt elfogadod, vagy ellenajánlatot teszel. Az okos árazó segít belőni a reális sávot.' },
    ],
    faq: [
      { q: 'Felviszik az emeletre?', a: 'Ha a feladásnál jelzed a bepakolási igényt (emelet, lift), a sofőr ezt előre látja és beárazza. Nehéz gépnél érdemes segítséget is jelölni.' },
      { q: 'A régi gépemet elviszik?', a: 'Ha a sofőr vállalja, egyeztethetitek — ez köztetek dől el, a GoFuvar csak összeköt.' },
    ],
  },
  {
    slug: 'marketplace-elhozas',
    kind: 'usecase',
    navLabel: 'Marketplace-elhozás',
    metaTitle: 'Jófogás, Marketplace vásárlás elhozása | GoFuvar',
    metaDescription: 'Vettél valamit Jófogáson vagy Facebook Marketplace-en, de nincs mivel elhozni? Egy sofőr elhozza neked. Fotó + 6 jegyű kód, a sofőrök versenye miatt gyakran kedvező áron.',
    eyebrow: 'Marketplace-elhozás',
    headline: 'Vettél valamit online? Elhozatjuk',
    subhead: 'Jófogás, Facebook Marketplace, apróhirdetés — a nagy vagy távoli tárgyat egy sofőr elhozza neked, aki úgyis arra jár. Te egyeztetsz az eladóval, a sofőr meg elhozza.',
    primaryCta: { label: 'Add fel az elhozást', href: '/bejelentkezes?mode=register' },
    bullets: [
      { icon: '🛒', title: 'Bármi, ami elfér', desc: 'Bútor, gép, terjedelmes tárgy — ami befér egy autóba vagy furgonba.' },
      { icon: '📍', title: 'Távoli eladótól is', desc: 'Ha az eladó egy másik városban van, egy arra tartó sofőr elhozza.' },
      { icon: '📸', title: 'Fotó + 6 jegyű kód', desc: 'A tárgyat a sofőr felvételkor és átadáskor is fotózza, a kézbesítést kód zárja.' },
      { icon: '💵', title: 'A sofőr ajánl, te döntesz', desc: 'A sofőrök árajánlatot tesznek; te a neked megfelelőt elfogadod, vagy ellenajánlatot teszel. Az okos árazó segít belőni a reális sávot.' },
    ],
    faq: [
      { q: 'Honnan hozza el a sofőr?', a: 'A feladásnál megadod a felvételi címet (az eladó címe), a sofőr onnan viszi a te címedre. Az eladóval az átadás időpontját neked kell egyeztetned.' },
      { q: 'Fizethet helyettem a sofőr?', a: 'Nem, a GoFuvar csak a szállítást közvetíti. Az áru árát az eladóval te rendezed.' },
    ],
  },
  {
    slug: 'autoszallitas',
    kind: 'usecase',
    navLabel: 'Autószállítás trélerrel',
    metaTitle: 'Autószállítás trélerrel — autó elvitele A-ból B-be | GoFuvar',
    metaDescription: 'Megvett vagy nem üzemképes autó elvitele tréleren. FONTOS: autót kizárólag engedéllyel rendelkező szállítóval vitess — a GoFuvar közvetítő, az engedélyt neked kell ellenőrizned.',
    eyebrow: 'Autószállítás trélerrel',
    headline: 'Autót vinnél tréleren?',
    subhead: 'Megvett autó, nem üzemképes jármű vagy projekt-autó — egy tréleres szállító elviheti A-ból B-be. ⚠️ Fontos: autót kizárólag ENGEDÉLLYEL RENDELKEZŐ szállítóval vitess — ezt neked kell ellenőrizned.',
    primaryCta: { label: 'Add fel az autószállítást', href: '/bejelentkezes?mode=register' },
    bullets: [
      { icon: '🚚', title: 'Tréleres szállító', desc: 'Olyan szállítót válassz, akinek van trélere és jogosultsága jármű szállítására — a feladásnál ezt egyeztesd.' },
      { icon: '⚠️', title: 'Az engedély a te felelősséged', desc: 'A GoFuvar közvetítő, nem fuvarozó: NEM ellenőrzi a szállító engedélyét. Neked kell meggyőződnöd róla, hogy a szállító jogosult autó szállítására.' },
      { icon: '📸', title: 'Fotó + 6 jegyű kód', desc: 'Az autót a szállító felvételkor és átadáskor is fotózza, az átadást 6 jegyű kód zárja.' },
      { icon: '💵', title: 'A szállító ajánl, te döntesz', desc: 'A szállítók árajánlatot tesznek; te a neked megfelelőt elfogadod, vagy ellenajánlatot teszel. Az okos árazó segít belőni a reális sávot.' },
    ],
    faq: [
      { q: 'Kell engedély az autószállításhoz?', a: 'Jármű közúti, kereskedelmi jellegű szállítása engedélyhez kötött lehet. A GoFuvar nem fuvarozó és nem ellenőrzi az engedélyeket — a feladó felelőssége, hogy engedéllyel rendelkező szállítót válasszon.' },
      { q: 'Nem üzemképes autót is elvisznek?', a: 'Ha a szállító trélerrel dolgozik és vállalja, igen — a részleteket (felhajtás, rögzítés) előre egyeztesd vele.' },
    ],
  },
];

// ─────────────────────────── Összesítő API ───────────────────────────
const ROUTE_CONFIGS = ROUTES.map(routeConfig);
export const ALL_LANDINGS: LandingConfig[] = [...ROUTE_CONFIGS, ...PERSONAS, ...USECASES];

export function getRouteLanding(slug: string): LandingConfig | undefined {
  return ROUTE_CONFIGS.find((c) => c.slug === slug);
}
export function getLandingBySlug(slug: string): LandingConfig | undefined {
  return ALL_LANDINGS.find((c) => c.slug === slug);
}
export function allRouteSlugs(): string[] {
  return ROUTE_CONFIGS.map((c) => c.slug);
}

/** A footer/„népszerű oldalak" linkekhez: rövid címke + href minden oldalhoz. */
export function landingLinks(): { href: string; label: string; kind: LandingConfig['kind'] }[] {
  return [
    ...ROUTE_CONFIGS.map((c) => ({ href: `/fuvar/${c.slug}`, label: c.navLabel, kind: c.kind })),
    ...PERSONAS.map((c) => ({ href: `/${c.slug}`, label: c.navLabel, kind: c.kind })),
    ...USECASES.map((c) => ({ href: `/${c.slug}`, label: c.navLabel, kind: c.kind })),
  ];
}
