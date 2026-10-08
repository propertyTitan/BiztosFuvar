'use client';

// GoFuvar marketing landing page – a bejelentkezés nélküli főoldal.
//
// SEO + bizalom: elmagyarázza a terméket (közösségi fuvarozás), bemutatja
// a 3 lépést, a fő funkciókat, a számokat és a két szerepkört, CTA-kkal.
//
// 'use client' a useCurrentUser miatt: belépett usernek a HomeHub jelenik meg.
//
// UX-kör (2026-10-08) — a főoldal az első 10 másodpercben mondja ki:
//  - MIT lehet vele szállíttatni (konkrét tárgyak + kattintható chipek, Q4),
//  - MENNYIBE kerül és mit kapsz érte (a díj már a hero-ban, Q1),
//  - hogy a SZÁLLÍTÓNAK is van bejárata (Q10), és a regisztráció a szándékot
//    viszi tovább (feladó → új fuvar űrlap, szállító → szállító mód; Q2, Q3).
//  A ma is igaz bizalmi elemek kerültek előre; a „Hamarosan" funkciók egy
//  kompakt sorba a rács alá (Q5). Mobilon ragadós CTA-sáv (Q11).
import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import {
  Route, MapPin, Camera, KeyRound, Leaf, Banknote, IdCard, Star, RefreshCw,
  Package, Truck, ArrowRight, Check, ShoppingBag, ShoppingCart, Sofa, Boxes,
  WashingMachine, type LucideIcon,
} from 'lucide-react';
import { useCurrentUser } from '@/lib/auth';
import ProductPreview from '@/components/ProductPreview';
import { JARAT_ENGEDELYEZVE } from '@/lib/features';
import { DIJ_SAVOK, DIJ_SAVHATAR_HUF, DIJ_SAV_MONDAT, ftFt } from '@/lib/connectionFee';
import { FELADO_REGISZTRACIO_HREF, SZALLITO_REGISZTRACIO_HREF } from '@/lib/landings';
import { useSutiDontesMegvan } from '@/lib/sutiDontes';

type Feature = { icon: LucideIcon; tint: string; title: string; desc: string };

// A ma is igaz bizalmi elemek, a feladó fő félelme (az idegen szállító)
// szerinti sorrendben. ⚠️ Az „Ellenőrzött" szót szándékosan kerüljük: a
// NAV-os cégjelvény el van halasztva (2026-09-27) — a személyazonosítás igaz.
const FEATURES: Feature[] = [
  { icon: IdCard, tint: 'var(--primary)', title: 'Személyazonosított szállítók',
    desc: 'Minden szállító személyi igazolvánnyal azonosítja magát, mielőtt ajánlatot tehet.' },
  { icon: Star, tint: 'var(--warning)', title: 'Értékelések',
    desc: 'Az ajánlatoknál látod a szállító értékeléseit, a profilján a teljesített fuvarjait — a fuvar után te is értékelhetsz.' },
  { icon: Banknote, tint: 'var(--success)', title: 'Közvetlen fizetés, kis díj',
    desc: `A fuvardíjat közvetlenül a szállítónak fizeted — készpénzben vagy átutalással, ahogy megegyeztek. A platformnak csak egy kis kapcsolatfelvételi díjat fizetsz (bevezető ár: ${DIJ_SAV_MONDAT}).` },
  { icon: Camera, tint: '#0891b2', title: 'Fotó bizonyíték',
    desc: 'A szállító felvételi és lerakodási fotóval igazolja a csomag állapotát — vita esetén ez a bizonyíték.' },
  { icon: KeyRound, tint: 'var(--warning)', title: '6 jegyű átvételi kód',
    desc: 'A lezáráshoz a szállítónak be kell írnia az átvevő 6 jegyű kódját. Nincs kód — nincs lezárt fuvar.' },
  { icon: RefreshCw, tint: 'var(--success)', title: 'Díjmentes újraválasztás',
    desc: 'Ha a szállító visszalép, ugyanarra a fuvarra új díj nélkül választhatsz másikat a beérkezett ajánlatok közül. (A megfizetett díj nem jár vissza, de újra sem kell fizetned.)' },
];

// Még nem élő funkciók — őszintén, jövő időben, a rács ALATT (Q5). A járat-ág
// a launchra rejtett (2026-09-11, D1); ha bekapcsolják, a rendes rácsba kerül.
const HAMAROSAN: { icon: LucideIcon; title: string; desc: string }[] = [
  ...(JARAT_ENGEDELYEZVE ? [] : [{
    icon: Route, title: 'Induló járatok',
    desc: 'a szállítók fix áron hirdetik majd az induló járatukat, te helyet foglalhatsz rajta',
  }]),
  // ⚠️ Szövegőr (13-as spec): az „élő GPS" után 40 karakteren belül ott kell
  // lennie, hogy hamarosan/érkezik — ezért áll elöl az „érkezik".
  { icon: MapPin, title: 'Élő GPS követés',
    desc: 'érkezik a GoFuvar mobilalkalmazással: a térképen követheted majd a szállítót' },
];
const JARAT_FEATURE: Feature = {
  icon: Route, tint: '#7c3aed', title: 'Induló járatok',
  desc: 'A szállítók meghirdetik a járatukat fix áron. Foglalj helyet a csomagodnak egyetlen kattintással.',
};

// Konkrét tárgyak — a látogató itt ismer magára (a három perszóna: bútor,
// marketplace-vásárlás, IKEA). A chipek a meglévő landingekre visznek.
const TARGY_CHIPEK: { icon: LucideIcon; label: string; href: string }[] = [
  { icon: Sofa, label: 'Bútor', href: '/butorszallitas' },
  { icon: ShoppingBag, label: 'IKEA-vásárlás', href: '/ikea-behozatal' },
  { icon: ShoppingCart, label: 'Marketplace-elhozás', href: '/marketplace-elhozas' },
  { icon: Boxes, label: 'Költözés', href: '/koltoztetes' },
  { icon: WashingMachine, label: 'Mosógép, hűtő', href: '/nagygep-szallitas' },
];

// A fuvar útjának három állomása — a lépések az útvonal-fonálra fűződnek:
// kék pont = feladás, köztes pont = úton, zöld végpont = kézbesítve
// (ugyanaz a színszemantika, mint a termék státuszaiban).
const STEPS = [
  { num: '1', title: 'Hirdesd meg a fuvart', dot: 'var(--primary)',
    desc: 'Add meg a felvételi és lerakodási címet, a csomag méreteit és a javasolt árat. Fotót is csatolhatsz.' },
  { num: '2', title: 'Válassz szállítót', dot: 'var(--primary)',
    desc: `Fogadd el a neked tetsző ajánlatot. A kapcsolatfelvételi díj (${DIJ_SAV_MONDAT} — bevezető ár) megfizetése után megkapod a választott szállító telefonszámát, ő pedig látja a pontos címet.` },
  { num: '3', title: 'Vedd át a kóddal', dot: 'var(--success)',
    desc: 'Ha más veszi át, a címzett a felvételkor SMS-ben kapja a 6 jegyű átvételi kódot és a szállító számát; ha te, a fuvar oldalán látod. Az átadáskor a kód zárja le a fuvart — a fuvardíjat közvetlenül a szállítóval rendezed, készpénzben vagy átutalással.' },
];

const TRUST = [
  { stat: '500 / 1 000 Ft', label: 'kapcsolatfelvételi díj (bevezető ár)' },
  { stat: '100%', label: 'a fuvardíjból a szállítóé — közvetlenül, levonás nélkül' },
  { stat: '6 jegyű', label: 'kód zárja le az átadást' },
  // UX-kör A9: a korábbi „24/7 AI segéd válaszol" a látogatónak nem volt
  // elérhető (az AI-segéd belépéshez kötött) — helyette egy ma is igaz ígéret.
  { stat: 'Díjmentes', label: 'újraválasztás, ha a szállító visszalép' },
];

/** A hero díj-pipája: a számok a díjsávokból jönnek, nem kézzel írtak. */
const HERO_DIJ = `${ftFt(DIJ_SAVOK[0].dijHuf)} díj — csak ha szállítót választasz (${ftFt(DIJ_SAVHATAR_HUF)} feletti fuvardíjnál ${ftFt(DIJ_SAVOK[1].dijHuf)})`;

const checkSor: React.CSSProperties = { display: 'inline-flex', alignItems: 'center', gap: 6 };

export default function LandingPage() {
  const user = useCurrentUser();
  const sutiDontes = useSutiDontesMegvan();
  // Ragadós mobil CTA (Q11): akkor jelenik meg, amikor a hero gombjai
  // kikerültek a nézetből — és csak a süti-döntés után (a süti-sáv is alul ül).
  const heroCtaRef = useRef<HTMLDivElement>(null);
  const [heroCtaLathato, setHeroCtaLathato] = useState(true);
  useEffect(() => {
    const el = heroCtaRef.current;
    if (!el || typeof IntersectionObserver === 'undefined') return;
    const obs = new IntersectionObserver(([e]) => setHeroCtaLathato(e.isIntersecting));
    obs.observe(el);
    return () => obs.disconnect();
  }, [user]);

  // Ha be van lépve, ne jelenjen meg a landing — a HomeHub kártyákat mutat.
  if (user) return null;

  return (
    <div style={{ maxWidth: 1100, margin: '0 auto', padding: '0 16px' }}>

      {/* ===== Hero ===== */}
      <section style={{ position: 'relative', textAlign: 'center', padding: '72px 0 56px' }}>
        {/* Lágy gradient-mesh háttér a mélységért */}
        <div aria-hidden style={{
          position: 'absolute', inset: '-40px -200px auto', height: 520, zIndex: -1,
          background: 'radial-gradient(60% 60% at 50% 0%, rgba(59,130,246,0.18) 0%, rgba(59,130,246,0) 70%)',
          pointerEvents: 'none',
        }} />
        {/* A „fuvartőzsde" B2B-szakszó a meta címben marad (SEO), ide a
            fogyasztó nyelvén mondjuk el, mi ez (Q4). */}
        <div style={{
          display: 'inline-flex', alignItems: 'center', gap: 8,
          background: 'var(--primary-subtle)', color: 'var(--primary-text)',
          padding: '6px 14px', borderRadius: 999, fontSize: 13, fontWeight: 700,
          marginBottom: 24, letterSpacing: 0.3, border: '1px solid var(--primary-light)',
        }}>
          <Truck size={16} /> Szállító, aki úgyis arra megy
        </div>
        <h1 style={{
          fontSize: 'clamp(34px, 5.5vw, 58px)', fontWeight: 800, lineHeight: 1.08,
          margin: '0 auto 6px', maxWidth: 720, letterSpacing: '-1.2px',
        }}>
          Csomagod van?{' '}
          {/* nowrap: a "Szállítód is lesz." egyben törjön új sorba, ne a közepén */}
          <span style={{
            background: 'linear-gradient(135deg, var(--primary) 0%, var(--primary-light) 100%)',
            WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent', backgroundClip: 'text',
            whiteSpace: 'nowrap',
          }}>Szállítód is lesz.</span>
        </h1>
        {/* A márka aláírása: A→B útvonal-vonal, betöltéskor megrajzolja
            magát (reduced-motion esetén azonnal kész). Kék pont = feladás,
            zöld = megérkezett. */}
        <svg
          className="route-draw"
          aria-hidden
          width="340" height="34" viewBox="0 0 340 34" fill="none"
          style={{ display: 'block', margin: '0 auto 18px', maxWidth: '70vw' }}
        >
          <path
            d="M12 26 C 100 4, 240 4, 328 20"
            stroke="var(--primary-light)" strokeWidth="3"
            strokeDasharray="1 10" strokeLinecap="round"
          />
          <circle cx="12" cy="26" r="6" fill="var(--primary)" />
          <circle cx="328" cy="20" r="6" fill="var(--success)" />
        </svg>
        <p style={{
          fontSize: 'clamp(16px, 2vw, 20px)', color: 'var(--text-secondary)',
          maxWidth: 600, margin: '0 auto 20px', lineHeight: 1.5,
        }}>
          Bútor, mosógép, Marketplace-en vett tárgy vagy egy kis költözés? Add fel
          ingyen, a szállítók ajánlatot tesznek rá, te választasz.
        </p>
        {/* Konkrét tárgyak — kattintható belépők a meglévő oldalakra (Q4) */}
        <ul aria-label="Mit szállíttatnál?" style={{
          listStyle: 'none', padding: 0, margin: '0 auto 24px', maxWidth: 680,
          display: 'flex', flexWrap: 'wrap', gap: 8, justifyContent: 'center',
        }}>
          {TARGY_CHIPEK.map((c) => {
            const Icon = c.icon;
            return (
              <li key={c.href}>
                <Link href={c.href} style={{
                  display: 'inline-flex', alignItems: 'center', gap: 6,
                  padding: '6px 12px', borderRadius: 999, fontSize: 14, fontWeight: 600,
                  textDecoration: 'none', color: 'var(--text)',
                  background: 'var(--surface)', border: '1px solid var(--border)',
                }}>
                  <Icon size={16} color="var(--primary-text)" aria-hidden /> {c.label}
                </Link>
              </li>
            );
          })}
        </ul>
        <div ref={heroCtaRef} style={{ display: 'flex', gap: 12, justifyContent: 'center', flexWrap: 'wrap' }}>
          <Link href={FELADO_REGISZTRACIO_HREF} className="btn"
            style={{ fontSize: 16, padding: '14px 30px', borderRadius: 12, fontWeight: 800 }}>
            Adj fel egy fuvart <ArrowRight size={18} />
          </Link>
          <a href="#hogyan-mukodik" className="btn btn-ghost"
            style={{ fontSize: 16, padding: '14px 28px', borderRadius: 12, fontWeight: 700 }}>
            Hogyan működik?
          </a>
        </div>
        <p style={{ color: 'var(--text-secondary)', fontSize: 14, margin: '14px auto 0', maxWidth: 560, lineHeight: 1.5 }}>
          A fuvardíjat közvetlenül a szállítónak fizeted — készpénzben vagy átutalással, ahogy megegyeztek.
        </p>
        {/* Korai szállítói bejárat (Q10) — a kínálati oldal sem 3000 px mélyen kezdődik */}
        <p style={{ fontSize: 14, margin: '8px 0 0' }}>
          <Link href="/soforoknek" style={{ fontWeight: 700, color: 'var(--primary-text)' }}>
            Szállító vagy? Így teszed pénzzé az utaidat →
          </Link>
        </p>
        {/* Social proof / bizalom-csík */}
        <div style={{
          display: 'flex', gap: 'clamp(12px, 3vw, 28px)', justifyContent: 'center',
          flexWrap: 'wrap', marginTop: 24, color: 'var(--muted)', fontSize: 13, fontWeight: 500,
        }}>
          <span style={checkSor}><Check size={16} color="var(--success)" /> Ingyenes regisztráció</span>
          <span style={checkSor}><Check size={16} color="var(--success)" /> Nincs havidíj</span>
          {/* GF-024 (2026-08-30): a díj az ajánlat ELFOGADÁSAKOR esedékes, nem
              a fuvar sikere után. UX-kör Q1: az összeg már itt látszik. */}
          <span style={checkSor}><Check size={16} color="var(--success)" /> {HERO_DIJ}</span>
        </div>

        {/* A termék maga: telefon-mockup, amin épp ajánlatok érkeznek —
            a "Szállítód is lesz." ígéret képileg beváltva */}
        <ProductPreview />
      </section>

      {/* ===== "Hozasd el" belépő sáv ===== */}
      <Link href="/hozasd-el" style={{ textDecoration: 'none' }}>
        <div className="card" style={{
          display: 'flex', alignItems: 'center', gap: 16, flexWrap: 'wrap',
          background: 'linear-gradient(135deg, var(--primary-subtle) 0%, var(--surface) 100%)',
          border: '1px solid var(--primary-light)', marginBottom: 0,
        }}>
          <div style={{ display: 'inline-flex', padding: 12, borderRadius: 14, background: 'rgba(30,64,175,0.12)' }}>
            <ShoppingBag size={24} color="var(--primary)" />
          </div>
          <div style={{ flex: '1 1 240px' }}>
            <div style={{ fontWeight: 800, fontSize: 18 }}>Vettél valamit online? Hozasd el.</div>
            <div className="muted" style={{ fontSize: 14 }}>
              Próbáld ki a terméklink előnézetét belépés nélkül. Link nélkül is elkezdheted a feladást.
            </div>
          </div>
          <span className="btn" style={{ pointerEvents: 'none' }}>
            Kipróbálom <ArrowRight size={18} />
          </span>
        </div>
      </Link>

      {/* ===== Hogyan működik? — 3 lépés ===== */}
      <section id="hogyan-mukodik" style={{ padding: '48px 0', scrollMarginTop: 80 }}>
        <h2 style={{ textAlign: 'center', fontSize: 'clamp(24px, 3vw, 32px)', fontWeight: 800, marginBottom: 40 }}>
          Hogyan működik?
        </h2>
        {/* A három lépés az útvonal-fonálra fűzve: a pontozott vonal a
            csomópontok mögött fut végig (csak asztali nézetben — egy
            oszlopban a fonál nem értelmezhető, ott elrejtjük). */}
        <div style={{ position: 'relative' }}>
          <div
            aria-hidden
            className="steps-thread"
            style={{
              position: 'absolute', top: 21, left: '12%', right: '12%', height: 3,
              backgroundImage: 'radial-gradient(circle, var(--primary-light) 1.6px, transparent 1.8px)',
              backgroundSize: '12px 3px', backgroundRepeat: 'repeat-x',
              opacity: 0.65,
            }}
          />
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))', gap: 24 }}>
            {STEPS.map((s) => (
              <div key={s.num} style={{ position: 'relative', textAlign: 'center' }}>
                <div style={{
                  width: 44, height: 44, borderRadius: '50%', margin: '0 auto 16px',
                  background: s.dot, color: '#fff',
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  fontSize: 18, fontWeight: 800, position: 'relative', zIndex: 1,
                  boxShadow: '0 0 0 6px var(--bg)',
                }}>{s.num}</div>
                <div className="card" style={{ marginBottom: 0, textAlign: 'left' }}>
                  <h3 style={{ fontSize: 20, fontWeight: 800, margin: '0 0 8px' }}>{s.title}</h3>
                  <p className="muted" style={{ fontSize: 14, lineHeight: 1.6, margin: 0 }}>{s.desc}</p>
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ===== Feature grid ===== */}
      <section style={{ padding: '48px 0' }}>
        {/* UX-kör A19: a „biztonságos fuvar" többet ígért, mint amit a
            közvetítő vállal — azt mondjuk, ami ellenőrizhető. */}
        <h2 style={{ textAlign: 'center', fontSize: 'clamp(24px, 3vw, 32px)', fontWeight: 800, marginBottom: 12 }}>
          Amivel a fuvar átlátható és ellenőrizhető
        </h2>
        <p style={{ textAlign: 'center', color: 'var(--muted)', maxWidth: 520, margin: '0 auto 40px', lineHeight: 1.5 }}>
          A GoFuvar nem csak összeköt feladót és szállítót — végigkísér az egész
          folyamaton, a feladástól az átadásig.
        </p>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 300px), 1fr))', gap: 16 }}>
          {[...FEATURES, ...(JARAT_ENGEDELYEZVE ? [JARAT_FEATURE] : [])].map((f) => {
            const Icon = f.icon;
            return (
              <div key={f.title} className="card" style={{ display: 'flex', gap: 16, alignItems: 'flex-start', marginBottom: 0 }}>
                <div style={{
                  width: 48, height: 48, borderRadius: 12, flexShrink: 0,
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  background: 'color-mix(in srgb, var(--surface-hover) 60%, transparent)',
                  border: '1px solid var(--border)',
                }}>
                  <Icon size={24} color={f.tint} strokeWidth={2.2} />
                </div>
                <div>
                  <h3 style={{ fontSize: 16, fontWeight: 700, margin: '0 0 4px' }}>{f.title}</h3>
                  <p className="muted" style={{ fontSize: 13, lineHeight: 1.5, margin: 0 }}>{f.desc}</p>
                </div>
              </div>
            );
          })}
        </div>
        {/* A még nem élő funkciók egy kompakt sorban, „Hamarosan" jelvénnyel —
            nem a rács legjobb helyén (Q5). Az élő GPS a mobil-fázisban jön. */}
        <div style={{
          marginTop: 16, display: 'flex', flexWrap: 'wrap', gap: '8px 20px',
          alignItems: 'baseline', justifyContent: 'center', color: 'var(--muted)', fontSize: 13,
        }}>
          <span style={{
            fontSize: 11, fontWeight: 700, letterSpacing: 0.3,
            background: 'var(--warning-light)', color: 'var(--text)',
            border: '1px solid var(--warning)',
            borderRadius: 999, padding: '2px 10px',
          }}>Hamarosan</span>
          {HAMAROSAN.map((h) => {
            const Icon = h.icon;
            return (
              <span key={h.title} style={{ display: 'inline-flex', alignItems: 'baseline', gap: 6 }}>
                <Icon size={14} aria-hidden style={{ alignSelf: 'center' }} />
                <span><strong style={{ color: 'var(--text)' }}>{h.title}</strong> — {h.desc}</span>
              </span>
            );
          })}
        </div>
      </section>

      {/* ===== Zöld / üzemanyag szekció ===== */}
      <section style={{ padding: '48px 0' }}>
        <div
          className="card"
          style={{
            background: 'var(--success-light)',
            border: '1px solid var(--success)',
            padding: 'clamp(24px, 4vw, 40px)',
            marginBottom: 0,
          }}
        >
          <h2 style={{
            textAlign: 'center', fontSize: 'clamp(24px, 3vw, 32px)', fontWeight: 800,
            margin: '0 0 12px', color: 'var(--success-text)',
            display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 10, flexWrap: 'wrap',
          }}>
            <Leaf size={24} aria-hidden /> Zöld, mert nem csinál felesleges utat
          </h2>
          <p style={{ textAlign: 'center', color: 'var(--text)', maxWidth: 620, margin: '0 auto 28px', lineHeight: 1.6 }}>
            A csomagod egy <strong>meglévő úton</strong> utazik: a szállító úgyis megy
            A-ból B-be. Nincs külön futárautó, nincs plusz károsanyag — egy hagyományos
            kézbesítéshez képest a kibocsátás elmarad. A szállító pedig egy úton, amit
            amúgy is megtenne, egy fuvarral <strong>hasznot termel</strong>.
          </p>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 16, maxWidth: 720, margin: '0 auto' }}>
            {[
              { big: '~43 kg', small: 'megspórolt CO₂ egy Budapest–Szeged fuvaron' },
              { big: '0', small: 'plusz futárautó — meglévő útra pakolsz' },
            ].map((s) => (
              <div key={s.small} className="card" style={{ textAlign: 'center', marginBottom: 0 }}>
                <div style={{ fontSize: 24, fontWeight: 800, color: 'var(--success-text)' }}>{s.big}</div>
                <div className="muted" style={{ fontSize: 13, lineHeight: 1.45, marginTop: 4 }}>{s.small}</div>
              </div>
            ))}
          </div>
          <p style={{ textAlign: 'center', color: 'var(--muted)', fontSize: 13, margin: '20px auto 0', maxWidth: 560 }}>
            A számok tájékoztató becslések (átlagos személyautó ~7 l/100km, elkerült dedikált
            futár-kisteher ~250 g CO₂/km).
          </p>
        </div>
      </section>

      {/* ===== Bizalom-csík — csendes, egysoros; a szám a mondat része,
           nem plakát (a "óriás szám + mini felirat" kártyarács helyett) ===== */}
      <section style={{ padding: '32px 0', borderTop: '1px solid var(--border)', borderBottom: '1px solid var(--border)' }}>
        <div style={{
          display: 'flex', flexWrap: 'wrap', justifyContent: 'center',
          gap: 'clamp(16px, 4vw, 48px)', alignItems: 'baseline',
        }}>
          {TRUST.map((t) => (
            <div key={t.label} style={{ display: 'flex', alignItems: 'baseline', gap: 8 }}>
              <span style={{
                fontFamily: 'var(--font-display), var(--font-inter), sans-serif',
                fontSize: 24, fontWeight: 800, color: 'var(--primary-text)',
                whiteSpace: 'nowrap',
              }}>{t.stat}</span>
              <span className="muted" style={{ fontSize: 14 }}>{t.label}</span>
            </div>
          ))}
        </div>
      </section>

      {/* ===== Két szerepkör ===== */}
      <section style={{ padding: '48px 0' }}>
        <h2 style={{ textAlign: 'center', fontSize: 'clamp(24px, 3vw, 32px)', fontWeight: 800, marginBottom: 40 }}>
          Két szerepkör — egy platform
        </h2>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 320px), 1fr))', gap: 24 }}>
          {/* Csak tokenek: dark módban a tint + felület együtt sötétül, az
              ikon a -text változatot kapja (light: mély, dark: világos szín) */}
          <div style={{
            background: 'linear-gradient(135deg, var(--primary-subtle) 0%, var(--surface) 100%)',
            borderRadius: 'var(--radius-xl)', padding: 32, border: '1px solid var(--primary-light)',
            display: 'flex', flexDirection: 'column',
          }}>
            <div style={{ display: 'inline-flex', alignSelf: 'flex-start', padding: 12, borderRadius: 14, background: 'rgba(30,64,175,0.12)', marginBottom: 16 }}>
              <Package size={24} color="var(--primary-text)" />
            </div>
            <h3 style={{ fontSize: 24, fontWeight: 800, marginBottom: 12, color: 'var(--text)' }}>Feladó vagyok</h3>
            <ul style={{ margin: '0 0 20px', padding: '0 0 0 20px', lineHeight: 2, color: 'var(--text)', fontSize: 16, flex: 1 }}>
              <li>Hirdesd meg a fuvart — a szállítók ajánlatot tesznek rá</li>
              {JARAT_ENGEDELYEZVE && <li>Vagy foglalj helyet egy induló járaton</li>}
              <li>Kis díj (500 / 1 000 Ft) után megkapod a szállító elérhetőségét</li>
              <li>Ha más veszi át, a címzett a felvételkor SMS-ben kapja az átvételi kódot</li>
              <li>Az átadáskor a 6 jegyű kód zárja le a fuvart, a fuvardíjat közvetlenül a szállítóval rendezed</li>
            </ul>
            {/* Q10: a kártya nem zsákutca */}
            <Link href={FELADO_REGISZTRACIO_HREF} className="btn" style={{ alignSelf: 'flex-start', fontSize: 16, padding: '12px 22px' }}>
              Fuvart adok fel <ArrowRight size={18} />
            </Link>
          </div>
          <div style={{
            background: 'linear-gradient(135deg, var(--success-light) 0%, var(--surface) 100%)',
            borderRadius: 'var(--radius-xl)', padding: 32, border: '1px solid var(--success)',
            display: 'flex', flexDirection: 'column',
          }}>
            <div style={{ display: 'inline-flex', alignSelf: 'flex-start', padding: 12, borderRadius: 14, background: 'rgba(22,163,74,0.12)', marginBottom: 16 }}>
              <Truck size={24} color="var(--success-text)" />
            </div>
            <h3 style={{ fontSize: 24, fontWeight: 800, marginBottom: 12, color: 'var(--text)' }}>Szállító vagyok</h3>
            <ul style={{ margin: '0 0 20px', padding: '0 0 0 20px', lineHeight: 2, color: 'var(--text)', fontSize: 16, flex: 1 }}>
              <li>Autó, bicikli, gyalog vagy tömegközlekedés — bármivel mehet</li>
              <li>Böngéssz az elérhető fuvarok között és tegyél ajánlatot</li>
              {JARAT_ENGEDELYEZVE && <li>Vagy hirdesd meg a járatodat fix árakkal</li>}
              <li>A fuvardíj 100%-a a tiéd — készpénzben vagy átutalással, nincs levonás</li>
              <li>Igazold a felvételt és lerakodást fotóval</li>
              <li>Kérd az átvételi kódot → fuvar lezárva, a fuvardíj a tiéd</li>
            </ul>
            <Link href={SZALLITO_REGISZTRACIO_HREF} className="btn btn-success" style={{ alignSelf: 'flex-start', fontSize: 16, padding: '12px 22px' }}>
              Szállítóként kezdem <ArrowRight size={18} />
            </Link>
          </div>
        </div>
      </section>

      {/* ===== Fuvarozó-toborzó sáv (a profi kínálati oldal a jó feladói élményhez) ===== */}
      <section style={{ padding: '24px 0 48px' }}>
        <div style={{
          background: 'linear-gradient(135deg, var(--primary-subtle) 0%, var(--surface) 100%)',
          border: '1px solid var(--primary-light)',
          borderRadius: 'var(--radius-xl)',
          padding: 'clamp(28px, 4vw, 44px)',
          display: 'flex', flexWrap: 'wrap', gap: 24,
          alignItems: 'center', justifyContent: 'space-between',
        }}>
          <div style={{ flex: '1 1 320px' }}>
            <div style={{ display: 'inline-flex', padding: 10, borderRadius: 12, background: 'rgba(30,64,175,0.12)', marginBottom: 12 }}>
              <Truck size={24} color="var(--primary-text)" />
            </div>
            <h2 style={{ fontSize: 'clamp(20px, 3vw, 24px)', fontWeight: 800, margin: '0 0 10px', color: 'var(--text)' }}>
              Fuvarozó cég vagy egyéni vállalkozó?
            </h2>
            <p style={{ color: 'var(--text)', margin: 0, lineHeight: 1.6, fontSize: 16, maxWidth: 560 }}>
              Töltsd meg az üres kilométereidet és a visszautaidat rendszeres fuvarokkal.
              A fuvardíj <strong>100%-a a tiéd</strong>, készpénzben vagy átutalással — a platform a te
              díjadból nem von le jutalékot.
            </p>
          </div>
          <Link href="/fuvarozoknak" className="btn"
            style={{ textDecoration: 'none', fontSize: 16, padding: '14px 26px', whiteSpace: 'nowrap' }}>
            Fuvarozóknak <ArrowRight size={18} />
          </Link>
        </div>
      </section>

      {/* ===== CTA ===== */}
      <section style={{ textAlign: 'center', padding: '64px 0', borderTop: '1px solid var(--border)' }}>
        {/* Q10: a korábbi „Kezdj el szállítani ma!" a feladónak félreérthető volt. */}
        <h2 style={{ fontSize: 'clamp(24px, 4vw, 32px)', fontWeight: 900, marginBottom: 16 }}>
          Add fel az első fuvarod — a feladás ingyenes
        </h2>
        <p style={{ color: 'var(--muted)', marginBottom: 32, fontSize: 16 }}>
          Regisztrálj ingyenesen, és pár perc múlva már feladhatsz egy fuvart —
          vagy szállítóként ajánlatot tehetsz egyre.
        </p>
        <div style={{ display: 'flex', gap: 12, justifyContent: 'center', flexWrap: 'wrap' }}>
          <Link href={FELADO_REGISZTRACIO_HREF} className="btn"
            style={{ fontSize: 18, padding: '16px 38px', borderRadius: 12, fontWeight: 800 }}>
            Fuvart adok fel <ArrowRight size={18} />
          </Link>
          <Link href={SZALLITO_REGISZTRACIO_HREF} className="btn btn-ghost"
            style={{ fontSize: 18, padding: '16px 30px', borderRadius: 12, fontWeight: 700 }}>
            Szállítóként csatlakozom
          </Link>
        </div>
      </section>

      {/* ===== Ragadós mobil CTA (Q11) =====
          Csak mobilon (CSS), csak ha a hero gombjai már nem látszanak, és csak
          a süti-döntés után — a két alsó sáv nem rakódhat egymásra. */}
      {sutiDontes && !heroCtaLathato && (
        <div className="landing-sticky-cta">
          <Link href={FELADO_REGISZTRACIO_HREF} className="btn" style={{ fontSize: 16, padding: '12px 18px', fontWeight: 800 }}>
            Adj fel egy fuvart <ArrowRight size={18} />
          </Link>
          <span className="landing-sticky-cta-dij">díj: 500 / 1 000 Ft, csak ha szállítót választasz</span>
        </div>
      )}
    </div>
  );
}
