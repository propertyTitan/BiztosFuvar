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
    metaDescription: 'Kanapé, szekrény, ágy — vidd el egy sofőrrel, aki úgyis arra megy. Gyakran olcsóbb, mint egy költöztető cég, és a csomagot fotó + 6 jegyű kód védi.',
    eyebrow: 'Bútorszállítás',
    headline: 'Bútort vinnél? Van rá sofőr',
    subhead: 'Egy kanapé, egy szekrény, egy marketplace-en vett asztal — a GoFuvar sofőrök elviszik, gyakran olcsóbban, mint egy dedikált költöztető. Te szabod meg a díjat a feladásnál.',
    primaryCta: REGISTER_CTA,
    bullets: [
      { icon: '🛋️', title: 'Nagy darab is elfér', desc: 'Nem futárcsomag-méret: bútor, több darab, terjedelmes tárgy — ami befér egy autóba vagy furgonba.' },
      { icon: '💪', title: 'Bepakolás jelölhető', desc: 'Feladáskor jelezheted, ha emeletre kell felvinni vagy segítség kell a pakoláshoz.' },
      { icon: '📸', title: 'Fotó + kód védelem', desc: 'A sofőr fotózza a bútort felvételkor és átadáskor, a kézbesítést 6 jegyű kód zárja.' },
      { icon: '💵', title: 'Te szabod az árat', desc: 'A feladásnál te adod meg a díjat (az okos árazó segít), a sofőrök arra licitálnak.' },
    ],
    faq: [
      { q: 'Mennyibe kerül a bútorszállítás?', a: 'A fuvardíjat te szabod meg feladáskor (az okos árazó ad egy sávot a távolság, súly és méret alapján), a sofőrök arra tesznek ajánlatot. A GoFuvar egy sávos kapcsolatfelvételi díjat számít az elfogadáskor.' },
      { q: 'Felviszik az emeletre?', a: 'Ha a feladásnál jelzed a bepakolási igényt (emelet, lift), a sofőr ezt előre látja és beárazza.' },
    ],
  },
  {
    slug: 'ikea-behozatal',
    kind: 'usecase',
    navLabel: 'IKEA-behozatal',
    metaTitle: 'IKEA, OBI, Praktiker behozatal — hozasd el a vásárlásod | GoFuvar',
    metaDescription: 'Megvan a termék linkje, de nincs mivel elhozni? Másold be, és egy sofőr elhozza az IKEA/OBI/Praktiker/Jófogás vásárlásod. Gyakran olcsóbb, mint a bolti kiszállítás.',
    eyebrow: 'Hozasd el',
    headline: 'Megvetted — hozasd el',
    subhead: 'IKEA, OBI, Praktiker, Jófogás: másold be a termék linkjét, mi kiolvassuk a méretet és a képet, egy sofőr pedig elhozza neked. Gyakran olcsóbb és rugalmasabb, mint a bolti kiszállítás.',
    primaryCta: { label: 'Hozasd el most', href: '/hozasd-el' },
    bullets: [
      { icon: '🔗', title: 'Csak a link kell', desc: 'Bemásolod a termék linkjét, mi előnézetet csinálunk (cím + kép), és előtöltjük a fuvart.' },
      { icon: '🚚', title: 'A sofőr elhozza', desc: 'Egy sofőr, aki úgyis arra jár, felveszi a boltból és házhoz viszi.' },
      { icon: '📸', title: 'Fotó + kód', desc: 'Ugyanaz a védelem, mint minden fuvarnál: fotó a felvételről és az átadásról, 6 jegyű kód.' },
      { icon: '💰', title: 'Gyakran olcsóbb', desc: 'Egy meglévő útra pakolva sokszor kedvezőbb, mint a bolti dedikált kiszállítás.' },
    ],
    faq: [
      { q: 'Mely boltok támogatottak?', a: 'IKEA, OBI, Praktiker, Jófogás termék-linkek előnézetét olvassuk ki. Más boltból a fuvart kézzel is feladhatod.' },
      { q: 'Honnan tudja a sofőr, mit hozzon?', a: 'A termék képe és adatai a sofőrhöz is eljutnak, így pontosan tudja, mit vegyen fel.' },
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
