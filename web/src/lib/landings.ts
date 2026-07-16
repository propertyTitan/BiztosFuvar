// Landing-oldalak adat-modellje.
//
// Minden kattintható marketing/SEO-oldal EGY adatból generálódik, egy közös
// sablonnal (LandingTemplate). Három típus: útvonal (route), célközönség
// (persona), használati eset (usecase). Új oldal = új bejegyzés ide, a
// megjelenítést nem kell írni.

import {
  Banknote, BicepsFlexed, Bike, Camera, Coins, HandCoins, Leaf, Link2,
  Map, MapPin, Package, Receipt, ShieldCheck, ShoppingCart, Sofa, Star,
  Timer, TriangleAlert, Truck, Undo2, WashingMachine, type LucideIcon,
} from 'lucide-react';

// Az icon lucide-komponens (emoji TILOS — platformonként másképp renderel);
// a tint a kártya-ikon színe, alapból var(--primary).
export type LandingBullet = { icon?: LucideIcon; tint?: string; title: string; desc: string };
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
    metaDescription: `Küldj csomagot vagy bútort ${title} útvonalon megbízható szállítókkal. Fotó + 6 jegyű átvételi kód, készpénzes fuvardíj, KYC-ellenőrzött szállítók. Add fel pár perc alatt.`,
    eyebrow: 'Útvonal',
    headline: `Fuvar ${title}`,
    subhead: `Csomag, bútor vagy bármi, ami elfér egy autóban — vidd el ${title} útvonalon egy szállítóval, aki úgyis arra megy. Meglévő út, tisztességes ár, biztonságos átadás.`,
    primaryCta: { label: 'Adj fel egy fuvart', href: '/bejelentkezes?mode=register' },
    route: { fromCity: r.from, toCity: r.to, distanceKm: r.km },
    bullets: [
      { icon: Leaf, tint: 'var(--success)', title: 'Zöld, mert meglévő úton megy', desc: `A szállító úgyis megy ${title} — a csomagod egy meglévő útra kerül, nincs plusz jármű, nincs plusz károsanyag.` },
      { icon: Camera, title: 'Fotó + 6 jegyű kód', desc: 'A szállító felvételkor és átadáskor is fotózza a csomagot, a kézbesítést pedig egy 6 jegyű átvételi kód zárja le.' },
      { icon: ShieldCheck, title: 'Ellenőrzött szállítók', desc: 'Minden szállító átmegy a személyazonosság-ellenőrzésen (KYC), mielőtt fuvart vállalhat.' },
      { icon: Banknote, tint: 'var(--success)', title: 'Készpénzes fuvardíj', desc: 'A fuvardíjat készpénzben adod a szállítónak; a GoFuvar csak egy kis kapcsolatfelvételi díjat szed elfogadáskor.' },
    ],
    faq: [
      { q: `Mennyibe kerül egy ${title} fuvar?`, a: 'A fuvardíjat a szállítóval egyeztetitek — feladáskor az okos árazó ad egy ajánlott sávot a távolság, súly és méret alapján. A GoFuvar ezen felül egy bevezető kapcsolatfelvételi díjat számít (50 000 Ft fuvardíjig 500 Ft, felette 1 000 Ft), amit a fuvar elfogadásakor fizetsz.' },
      { q: 'Mennyi idő alatt indul?', a: 'Amint egy szállító elfogadja a fuvart és kifizeted a kapcsolatfelvételi díjat, megkapjátok egymás elérhetőségét, és egyeztethettek időpontot.' },
      { q: 'Mit küldhetek?', a: 'Bármit, ami elfér egy autóban és jogszerű. Speciális áruhoz (pl. élő állat, gyógyszer) neked kell ellenőrizned a szállító engedélyét.' },
    ],
  };
}

// ─────────────────────────── CÉLKÖZÖNSÉG-OLDALAK ───────────────────────────
const PERSONAS: LandingConfig[] = [
  {
    slug: 'soforoknek',
    kind: 'persona',
    navLabel: 'Szállítóknak',
    metaTitle: 'Sofőröknek, futároknak, fuvarozóknak — legyél GoFuvar szállító',
    metaDescription: 'Sofőr, futár vagy fuvarozó vagy — vagy csak úgyis mész A-ból B-be? Vállalj fuvart az útvonaladon szállítóként. A fuvardíj készpénzben a tiéd, te választod a fuvart.',
    eyebrow: 'Szállítóknak',
    headline: 'Az utaidat pénzzé teszed — bármivel',
    subhead: 'Ha úgyis mész valahová — autóval, biciklivel, gyalog vagy tömegközlekedéssel —, vigyél magaddal egy csomagot az útvonaladon. Elég hozzá a személyi igazolványod. Te döntöd el, melyik fuvart vállalod.',
    primaryCta: { label: 'Regisztrálj szállítóként', href: '/bejelentkezes?mode=register' },
    bullets: [
      { icon: Bike, title: 'Bármivel szállíthatsz', desc: 'Autó, furgon, bicikli, gyalog vagy tömegközlekedés — mind mehet. Elég hozzá a személyi igazolványod.' },
      { icon: Timer, title: 'A lényeg a pontosság', desc: 'Ami számít: időben odaérsz, és betartod, amit az ajánlatodban vállaltál. A jó értékelések hozzák a következő fuvart.' },
      { icon: Map, title: 'Útvonal-figyelő', desc: 'Állítsd be a szokásos útvonaladat, és e-mailben szólunk, amikor illő fuvar kerül ki rá.' },
      { icon: Banknote, tint: 'var(--success)', title: 'Készpénz, azonnal', desc: 'A fuvardíjat a feladótól készpénzben kapod, levonás nélkül — a GoFuvar a fuvardíjhoz nem nyúl.' },
    ],
    faq: [
      { q: 'Kell hozzá vállalkozás?', a: 'A saját adóügyi státuszodért te felelsz (rendszeres kereső tevékenységhez a magyar jog szerint általában vállalkozói forma kell). A GoFuvar a fuvardíjat nem kezeli és nem számlázza — az a te és a feladó közti készpénzes ügylet.' },
      { q: 'Hogyan kezdjek?', a: 'Regisztrálj, igazold a személyazonosságod (személyi igazolvány), fogadd el a rövid szállítói nyilatkozatot (jogszabályok + KRESZ betartása), és már ajánlatot tehetsz a fuvarokra — autóval, biciklivel, gyalog vagy tömegközlekedéssel is.' },
      { q: 'Én választom a fuvart?', a: 'Igen. Te böngészed a fuvarokat, te adsz ajánlatot, és csak azt vállalod, ami neked megéri.' },
    ],
  },
  {
    slug: 'webshopoknak',
    kind: 'persona',
    navLabel: 'Webshopoknak',
    metaTitle: 'Rugalmas kiszállítás webshopoknak és marketplace-eladóknak | GoFuvar',
    metaDescription: 'Nagy vagy terjedelmes termék, amit a futárszolgálat nehezen visz? Kínálj a vásárlóidnak GoFuvar-kiszállítást: ellenőrzött szállítók, fotó + kód, céges számla.',
    eyebrow: 'Webshopoknak',
    headline: 'Kiszállítás, ami a terjedelmes termékre is jó',
    subhead: 'Bútor, nagy doboz, több darab? A GoFuvar szállítók oda viszik, ahová a szokásos futár nehezen. Céges fiókkal, számlával, ellenőrzött szállítókkal.',
    primaryCta: { label: 'Hozz létre céges fiókot', href: '/bejelentkezes?mode=register' },
    bullets: [
      { icon: Package, title: 'Terjedelmes áru is', desc: 'Nem méret-korlátos futárcsomag: bármi, ami elfér egy autóban vagy furgonban.' },
      { icon: Receipt, title: 'Céges fiók + számla', desc: 'Adószámmal regisztrálsz, a kapcsolatfelvételi díjról számlát kapsz.' },
      { icon: ShieldCheck, title: 'Ellenőrzött szállítók', desc: 'KYC-ellenőrzött szállítók, fotó a felvételről és az átadásról, 6 jegyű átvételi kód.' },
      { icon: Leaf, tint: 'var(--success)', title: 'Zöldebb kiszállítás', desc: 'A csomag meglévő úton utazik — kevesebb kibocsátás, amit a vásárlóidnak is kommunikálhatsz.' },
    ],
    faq: [
      { q: 'Hogyan integrálom a boltomba?', a: 'Induláskor manuális feladással működik (pár perc/rendelés). A webshop-integráció a roadmapen van — jelezd az igényt, és előre veszünk.' },
      { q: 'Kapok számlát?', a: 'Igen, a kapcsolatfelvételi díjról a céges adataiddal kiállított számlát kapsz.' },
    ],
  },
  {
    slug: 'fuvarozoknak',
    kind: 'persona',
    navLabel: 'Fuvarozóknak',
    metaTitle: 'Fuvarozó cégeknek és egyéni vállalkozóknak — rendszeres fuvar jutalék nélkül | GoFuvar',
    metaDescription: 'Fuvarozó vállalkozás vagy egyéni vállalkozó? Töltsd meg az üres visszautaidat, kapj rendszeres fuvarokat az útvonaladon, és tartsd meg a fuvardíj 100%-át készpénzben — a platform nem von le jutalékot a díjadból.',
    eyebrow: 'Fuvarozó vállalkozásoknak',
    headline: 'Rendszeres fuvar a vállalkozásodnak — jutalék nélkül',
    subhead: 'Fuvarozó cég, egyéni vállalkozó vagy hivatásos szállító? Töltsd meg az üres kilométereidet és a visszautaidat rendszeres fuvarokkal. A fuvardíj 100%-a a tiéd, készpénzben — a GoFuvar a te díjadból NEM von le jutalékot.',
    primaryCta: { label: 'Regisztrálj fuvarozóként', href: '/bejelentkezes?mode=register' },
    bullets: [
      { icon: HandCoins, tint: 'var(--success)', title: 'A fuvardíj 100%-a a tiéd', desc: 'A díjat készpénzben kapod a feladótól, a platform NEM von le belőle jutalékot. A GoFuvar bevétele a feladótól szedett kapcsolatfelvételi díj — a te díjadhoz nem nyúlunk.' },
      { icon: Undo2, title: 'Töltsd meg az üres visszautat', desc: 'A visszafuvar-matching felajánlja a visszaútra eső fuvarokat, hogy ne menj üresen — a holtkilométer bevétellé válik.' },
      { icon: Map, title: 'Rendszeres fuvar az útvonaladon', desc: 'Állítsd be a szokásos útvonalaidat, és e-mailben szólunk a rád illő fuvarokról — nem kell folyton keresgélned.' },
      { icon: Receipt, title: 'Céges / EV fiók', desc: 'Adószámmal céges vagy egyéni vállalkozói fiókot hozol létre — professzionális profil, ami bizalmat ad a feladónak.' },
      { icon: Star, tint: 'var(--warning)', title: 'Építs reputációt', desc: 'Az értékeléseid és a teljesített fuvaraid előrébb hoznak; a megbízható fuvarozók kapják a legtöbb megkeresést.' },
    ],
    faq: [
      { q: 'Mennyit von le a platform a fuvardíjból?', a: 'Semmit. A fuvardíj 100%-a a tiéd, készpénzben. A GoFuvar bevétele a feladótól szedett kapcsolatfelvételi díj — a te díjadhoz nem nyúlunk.' },
      { q: 'Hogyan jutok rendszeresen fuvarhoz?', a: 'Böngészed a kiírt fuvarokat és árajánlatot adsz; az útvonal-figyelővel e-mailben szólunk a rád illő fuvarokról; a visszafuvar-matching pedig az üres visszautat is megtölti.' },
      { q: 'Céges vagy egyéni vállalkozóként is működik?', a: 'Igen. Adószámmal céges vagy EV fiókot hozhatsz létre. A saját számlázásodat (a feladó felé, a fuvardíjról) te intézed, ahogy a jogszabály előírja — a GoFuvar a fuvardíjat nem kezeli.' },
      { q: 'Kell azonosítás?', a: 'Igen: személyazonosság-ellenőrzés (személyi igazolvány) szükséges. Szállítóként ezen felül egy rövid nyilatkozatot fogadsz el (jogszabályok + KRESZ betartása).' },
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
    metaDescription: 'Kanapé, szekrény, ágy — vidd el egy szállítóval, aki úgyis arra megy. A szállítók versenye miatt gyakran kedvező áron, és a csomagot fotó + 6 jegyű kód védi.',
    eyebrow: 'Bútorszállítás',
    headline: 'Bútort vinnél? Van rá szállító',
    subhead: 'Egy kanapé, egy szekrény, egy marketplace-en vett asztal — a GoFuvar szállítók elviszik. A szállítók ajánlatot tesznek rá, te a neked megfelelőt választod — a verseny miatt gyakran kedvező áron.',
    primaryCta: REGISTER_CTA,
    bullets: [
      { icon: Sofa, title: 'Nagy darab is elfér', desc: 'Nem futárcsomag-méret: bútor, több darab, terjedelmes tárgy — ami befér egy autóba vagy furgonba.' },
      { icon: BicepsFlexed, title: 'Bepakolás jelölhető', desc: 'Feladáskor jelezheted, ha emeletre kell felvinni vagy segítség kell a pakoláshoz.' },
      { icon: Camera, title: 'Fotó + kód védelem', desc: 'A szállító fotózza a bútort felvételkor és átadáskor, a kézbesítést 6 jegyű kód zárja.' },
      { icon: Banknote, tint: 'var(--success)', title: 'A szállító ajánl, te döntesz', desc: 'A szállítók árajánlatot tesznek a fuvarodra; te a neked megfelelőt elfogadod, vagy ellenajánlatot teszel. Az okos árazó segít belőni a reális sávot.' },
    ],
    faq: [
      { q: 'Mennyibe kerül a bútorszállítás?', a: 'Feladáskor az okos árazó ad egy ajánlott sávot a távolság, súly és méret alapján; a szállítók erre tesznek árajánlatot, te pedig a neked megfelelőt elfogadod. A GoFuvar egy sávos kapcsolatfelvételi díjat számít az elfogadáskor.' },
      { q: 'Felviszik az emeletre?', a: 'Ha a feladásnál jelzed a bepakolási igényt (emelet, lift), a szállító ezt előre látja és beárazza.' },
    ],
  },
  {
    slug: 'ikea-behozatal',
    kind: 'usecase',
    navLabel: 'IKEA-behozatal',
    metaTitle: 'IKEA, OBI, Praktiker behozatal — hozasd el a vásárlásod | GoFuvar',
    metaDescription: 'Megvan a termék linkje, de nincs mivel elhozni? Másold be, és egy szállító elhozza az IKEA/OBI/Praktiker/Jófogás vásárlásod. A szállítók versenye miatt gyakran kedvező áron.',
    eyebrow: 'Hozasd el',
    headline: 'Megvetted — hozasd el',
    subhead: 'IKEA, OBI, Praktiker, Jófogás: másold be a termék linkjét, mi kiolvassuk a méretet és a képet, egy szállító pedig elhozza neked. Rugalmas, és a szállítók versenye miatt gyakran kedvező áron.',
    primaryCta: { label: 'Hozasd el most', href: '/hozasd-el' },
    bullets: [
      { icon: Link2, title: 'Csak a link kell', desc: 'Bemásolod a termék linkjét, mi előnézetet csinálunk (cím + kép), és előtöltjük a fuvart.' },
      { icon: Truck, title: 'A szállító elhozza', desc: 'Egy szállító, aki úgyis arra jár, felveszi a boltból és házhoz viszi.' },
      { icon: Camera, title: 'Fotó + kód', desc: 'Ugyanaz a védelem, mint minden fuvarnál: fotó a felvételről és az átadásról, 6 jegyű kód.' },
      { icon: Coins, tint: 'var(--success)', title: 'Versenyző árak', desc: 'Több szállító tesz ajánlatot a fuvarra, és egy meglévő útra pakolva az ár gyakran kedvező.' },
    ],
    faq: [
      { q: 'Mely boltok támogatottak?', a: 'IKEA, OBI, Praktiker, Jófogás termék-linkek előnézetét olvassuk ki. Más boltból a fuvart kézzel is feladhatod.' },
      { q: 'Honnan tudja a szállító, mit hozzon?', a: 'A termék képe és adatai a szállítóhoz is eljutnak, így pontosan tudja, mit vegyen fel.' },
    ],
  },
  {
    slug: 'koltoztetes',
    kind: 'usecase',
    navLabel: 'Költöztetés',
    metaTitle: 'Költöztetés olcsón — kis költözés szállítóval | GoFuvar',
    metaDescription: 'Albérlet-váltás, néhány bútor és doboz? Vidd el egy szállítóval, aki úgyis arra megy. A szállítók versenye miatt gyakran kedvező áron, fotó + 6 jegyű átvételi kód.',
    eyebrow: 'Költöztetés',
    headline: 'Költözöl? Nem kell hozzá teljes költöztető cég',
    subhead: 'Egy albérlet-váltás, pár bútor és néhány doboz — a GoFuvar szállítók rugalmasan elviszik. A szállítók ajánlatot tesznek rá, te a neked megfelelőt választod — a verseny miatt gyakran kedvező áron.',
    primaryCta: { label: 'Add fel a költözésed', href: '/bejelentkezes?mode=register' },
    bullets: [
      { icon: Package, title: 'Bútor és doboz egyben', desc: 'Nem futárcsomag-méret: bútor, dobozok, terjedelmes tárgyak — ami befér egy autóba vagy furgonba.' },
      { icon: BicepsFlexed, title: 'Bepakolás, emelet jelölhető', desc: 'Feladáskor jelezheted, ha emeletre kell felvinni vagy segítség kell a pakoláshoz — a szállító előre látja.' },
      { icon: ShieldCheck, title: 'Ellenőrzött szállítók, fotó + kód', desc: 'KYC-ellenőrzött szállítók, fotó a felvételről és az átadásról, 6 jegyű átvételi kód.' },
      { icon: Banknote, tint: 'var(--success)', title: 'A szállító ajánl, te döntesz', desc: 'A szállítók árajánlatot tesznek a fuvarodra; te a neked megfelelőt elfogadod, vagy ellenajánlatot teszel. Az okos árazó segít belőni a reális sávot.' },
    ],
    faq: [
      { q: 'Mennyibe kerül egy kis költözés?', a: 'Feladáskor az okos árazó ad egy ajánlott sávot a távolság, súly és méret alapján; a szállítók erre tesznek árajánlatot, te pedig a neked megfelelőt elfogadod. A GoFuvar egy sávos kapcsolatfelvételi díjat számít az elfogadáskor.' },
      { q: 'Nagyobb költözésre is jó?', a: 'Ami elfér egy autóban vagy furgonban, azt egy fuvarral; nagyobb mennyiséget több fordulóval vagy nagyobb járművű szállítóval. A feladásnál jelöld a méretet, hogy a megfelelő szállító vállalja.' },
    ],
  },
  {
    slug: 'nagygep-szallitas',
    kind: 'usecase',
    navLabel: 'Nagygép-szállítás',
    metaTitle: 'Mosógép, hűtő szállítás — nagygép elvitele | GoFuvar',
    metaDescription: 'Mosógép, hűtő, mosogatógép, szárítógép elvitele egy szállítóval furgonnal. A szállítók versenye miatt gyakran kedvező áron, fotó + 6 jegyű átvételi kód.',
    eyebrow: 'Nagygép-szállítás',
    headline: 'Mosógép, hűtő? Van rá szállító furgonnal',
    subhead: 'Nagy háztartási gép, ami nem fér a kocsidba? Egy GoFuvar szállító furgonnal elviszi. A szállítók ajánlatot tesznek rá, te a neked megfelelőt fogadod el — a verseny miatt gyakran kedvező áron.',
    primaryCta: { label: 'Add fel a szállítást', href: '/bejelentkezes?mode=register' },
    bullets: [
      { icon: WashingMachine, title: 'Nagygép is elfér', desc: 'Mosógép, hűtő, mosogatógép, szárítógép — furgonos szállító elviszi.' },
      { icon: BicepsFlexed, title: 'Bepakolás, emelet jelölhető', desc: 'Ha emeletre kell felvinni vagy segítség kell, jelöld a feladásnál — a szállító beárazza.' },
      { icon: Camera, title: 'Fotó + 6 jegyű kód', desc: 'A gépet a szállító felvételkor és átadáskor is fotózza, a kézbesítést kód zárja.' },
      { icon: Banknote, tint: 'var(--success)', title: 'A szállító ajánl, te döntesz', desc: 'A szállítók árajánlatot tesznek; te a neked megfelelőt elfogadod, vagy ellenajánlatot teszel. Az okos árazó segít belőni a reális sávot.' },
    ],
    faq: [
      { q: 'Felviszik az emeletre?', a: 'Ha a feladásnál jelzed a bepakolási igényt (emelet, lift), a szállító ezt előre látja és beárazza. Nehéz gépnél érdemes segítséget is jelölni.' },
      { q: 'A régi gépemet elviszik?', a: 'Ha a szállító vállalja, egyeztethetitek — ez köztetek dől el, a GoFuvar csak összeköt.' },
    ],
  },
  {
    slug: 'marketplace-elhozas',
    kind: 'usecase',
    navLabel: 'Marketplace-elhozás',
    metaTitle: 'Jófogás, Marketplace vásárlás elhozása | GoFuvar',
    metaDescription: 'Vettél valamit Jófogáson vagy Facebook Marketplace-en, de nincs mivel elhozni? Egy szállító elhozza neked. Fotó + 6 jegyű kód, a szállítók versenye miatt gyakran kedvező áron.',
    eyebrow: 'Marketplace-elhozás',
    headline: 'Vettél valamit online? Elhozatjuk',
    subhead: 'Jófogás, Facebook Marketplace, apróhirdetés — a nagy vagy távoli tárgyat egy szállító elhozza neked, aki úgyis arra jár. Te egyeztetsz az eladóval, a szállító meg elhozza.',
    primaryCta: { label: 'Add fel az elhozást', href: '/bejelentkezes?mode=register' },
    bullets: [
      { icon: ShoppingCart, title: 'Bármi, ami elfér', desc: 'Bútor, gép, terjedelmes tárgy — ami befér egy autóba vagy furgonba.' },
      { icon: MapPin, title: 'Távoli eladótól is', desc: 'Ha az eladó egy másik városban van, egy arra tartó szállító elhozza.' },
      { icon: Camera, title: 'Fotó + 6 jegyű kód', desc: 'A tárgyat a szállító felvételkor és átadáskor is fotózza, a kézbesítést kód zárja.' },
      { icon: Banknote, tint: 'var(--success)', title: 'A szállító ajánl, te döntesz', desc: 'A szállítók árajánlatot tesznek; te a neked megfelelőt elfogadod, vagy ellenajánlatot teszel. Az okos árazó segít belőni a reális sávot.' },
    ],
    faq: [
      { q: 'Honnan hozza el a szállító?', a: 'A feladásnál megadod a felvételi címet (az eladó címe), a szállító onnan viszi a te címedre. Az eladóval az átadás időpontját neked kell egyeztetned.' },
      { q: 'Fizethet helyettem a szállító?', a: 'Nem, a GoFuvar csak a szállítást közvetíti. Az áru árát az eladóval te rendezed.' },
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
      { icon: Truck, title: 'Tréleres szállító', desc: 'Olyan szállítót válassz, akinek van trélere és jogosultsága jármű szállítására — a feladásnál ezt egyeztesd.' },
      { icon: TriangleAlert, tint: 'var(--warning)', title: 'Az engedély a te felelősséged', desc: 'A GoFuvar közvetítő, nem fuvarozó: NEM ellenőrzi a szállító engedélyét. Neked kell meggyőződnöd róla, hogy a szállító jogosult autó szállítására.' },
      { icon: Camera, title: 'Fotó + 6 jegyű kód', desc: 'Az autót a szállító felvételkor és átadáskor is fotózza, az átadást 6 jegyű kód zárja.' },
      { icon: Banknote, tint: 'var(--success)', title: 'A szállító ajánl, te döntesz', desc: 'A szállítók árajánlatot tesznek; te a neked megfelelőt elfogadod, vagy ellenajánlatot teszel. Az okos árazó segít belőni a reális sávot.' },
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
