'use client';

// GoFuvar marketing landing page – a bejelentkezés nélküli főoldal.
//
// SEO + bizalom: elmagyarázza a terméket (közösségi fuvartőzsde), bemutatja
// a 3 lépést, a fő funkciókat, a számokat és a két szerepkört, CTA-kkal.
//
// 'use client' a useCurrentUser miatt: belépett usernek a HomeHub jelenik meg.
import Link from 'next/link';
import {
  Gavel, Route, MapPin, ShieldCheck, Camera, KeyRound,
  Package, Truck, ArrowRight, Check, ShoppingBag, type LucideIcon,
} from 'lucide-react';
import { useCurrentUser } from '@/lib/auth';

const FEATURES: { icon: LucideIcon; tint: string; title: string; desc: string; soon?: boolean }[] = [
  { icon: Gavel, tint: 'var(--primary)', title: 'Licitálható fuvarok',
    desc: 'Hirdesd meg a csomagodat, és a sofőrök licitálnak rá. Te döntöd el, melyik ajánlatot fogadod el.' },
  { icon: Route, tint: '#7c3aed', title: 'Fix áras útvonalak',
    desc: 'A sofőrök meghirdetik az útjukat fix áron. Foglalj helyet a csomagodnak egyetlen kattintással.' },
  // Az élő GPS a mobilapppal érkezik — a launchkor még nincs, ezért
  // ŐSZINTÉN jelöljük: "Hamarosan" badge, jövő időben fogalmazva.
  { icon: MapPin, tint: '#db2777', title: 'Élő GPS követés', soon: true,
    desc: 'A GoFuvar mobilalkalmazással érkezik: valós időben követheted majd a sofőröd pozícióját a térképen.' },
  { icon: ShieldCheck, tint: 'var(--success)', title: 'Készpénzes fizetés, kis díj',
    desc: 'A fuvardíjat készpénzben adod a sofőrnek — a platformnak csak egy kis kapcsolatfelvételi díjat fizetsz (bevezető áron már 500 Ft-tól).' },
  { icon: Camera, tint: '#0891b2', title: 'Fotó bizonyíték',
    desc: 'A sofőr felvételi és lerakodási fotóval igazolja a csomag állapotát — vita esetén ez a bizonyíték.' },
  { icon: KeyRound, tint: 'var(--warning)', title: '6 jegyű átvételi kód',
    desc: 'A lezáráshoz a sofőrnek be kell írnia a feladó 6 jegyű kódját. Nincs kód — nincs lezárt fuvar.' },
];

// A fuvar útjának három állomása — a lépések az útvonal-fonálra fűződnek:
// kék pont = feladás, köztes pont = úton, zöld végpont = kézbesítve
// (ugyanaz a színszemantika, mint a termék státuszaiban).
const STEPS = [
  { num: '1', title: 'Hirdesd meg a fuvart', dot: 'var(--primary)',
    desc: 'Add meg a felvételi és lerakodási címet, a csomag méreteit és a javasolt árat. Fotót is csatolhatsz.' },
  { num: '2', title: 'Válassz sofőrt', dot: 'var(--primary)',
    desc: 'Fogadd el a legjobb licitet, vagy foglalj fix áras útvonalon. Egy kis kapcsolatfelvételi díj után azonnal megkapod a sofőr elérhetőségét.' },
  { num: '3', title: 'Vedd át a kóddal', dot: 'var(--success)',
    desc: 'A címzett SMS-ben kapja a követési linket és a kódot. Az átvételkor add át a 6 jegyű kódot — a fuvardíjat készpénzben rendezed a sofőrrel.' },
];

const TRUST = [
  { stat: '500 Ft-tól', label: 'kapcsolatfelvételi díj (bevezető ár)' },
  { stat: '100%', label: 'a fuvardíjból a sofőré — készpénzben' },
  { stat: '6 jegyű', label: 'kód zárja le az átadást' },
  { stat: '24/7', label: 'AI segéd válaszol' },
];

export default function LandingPage() {
  const user = useCurrentUser();
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
        <div style={{
          display: 'inline-flex', alignItems: 'center', gap: 8,
          background: 'var(--primary-subtle)', color: 'var(--primary-text)',
          padding: '6px 14px', borderRadius: 999, fontSize: 13, fontWeight: 700,
          marginBottom: 24, letterSpacing: 0.3, border: '1px solid var(--primary-light)',
        }}>
          <Truck size={15} /> Magyarország közösségi fuvartőzsdéje
        </div>
        <h1 style={{
          fontSize: 'clamp(34px, 5.5vw, 58px)', fontWeight: 800, lineHeight: 1.08,
          margin: '0 auto 6px', maxWidth: 720, letterSpacing: '-1.2px',
        }}>
          Csomagod van?{' '}
          <span style={{
            background: 'linear-gradient(135deg, var(--primary) 0%, var(--primary-light) 100%)',
            WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent', backgroundClip: 'text',
          }}>Sofőröd is lesz.</span>
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
          maxWidth: 580, margin: '0 auto 32px', lineHeight: 1.5,
        }}>
          Hirdess meg egy fuvart és a sofőrök licitálnak rá — vagy foglalj
          helyet egy útba eső sofőr fix áras útvonalán. Biztonságos fizetés,
          fotó bizonyíték, 6 jegyű átvételi kód.
        </p>
        <div style={{ display: 'flex', gap: 12, justifyContent: 'center', flexWrap: 'wrap' }}>
          <Link href="/bejelentkezes?mode=register" className="btn"
            style={{ fontSize: 16, padding: '14px 30px', borderRadius: 12, fontWeight: 800 }}>
            Adj fel egy fuvart <ArrowRight size={18} />
          </Link>
          <a href="#hogyan-mukodik" className="btn btn-ghost"
            style={{ fontSize: 16, padding: '14px 28px', borderRadius: 12, fontWeight: 700 }}>
            Hogyan működik?
          </a>
        </div>
        {/* Social proof / bizalom-csík */}
        <div style={{
          display: 'flex', gap: 'clamp(12px, 3vw, 28px)', justifyContent: 'center',
          flexWrap: 'wrap', marginTop: 28, color: 'var(--muted)', fontSize: 13, fontWeight: 500,
        }}>
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}><Check size={15} color="var(--success)" /> Ingyenes regisztráció</span>
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}><Check size={15} color="var(--success)" /> Nincs havidíj</span>
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}><Check size={15} color="var(--success)" /> Csak sikeres fuvar után fizetsz</span>
        </div>
      </section>

      {/* ===== "Hozasd el" belépő sáv ===== */}
      <Link href="/hozasd-el" style={{ textDecoration: 'none' }}>
        <div className="card" style={{
          display: 'flex', alignItems: 'center', gap: 16, flexWrap: 'wrap',
          background: 'linear-gradient(135deg, var(--primary-subtle) 0%, var(--surface) 100%)',
          border: '1px solid var(--primary-light)', marginBottom: 0,
        }}>
          <div style={{ display: 'inline-flex', padding: 12, borderRadius: 14, background: 'rgba(30,64,175,0.12)' }}>
            <ShoppingBag size={26} color="var(--primary)" />
          </div>
          <div style={{ flex: '1 1 240px' }}>
            <div style={{ fontWeight: 800, fontSize: 18 }}>Vettél valamit online? Hozasd el.</div>
            <div className="muted" style={{ fontSize: 14 }}>
              IKEA, OBI, Praktiker vagy Jófogás link → pár kattintás, és egy sofőr elhozza.
            </div>
          </div>
          <span className="btn" style={{ pointerEvents: 'none' }}>
            Kipróbálom <ArrowRight size={18} />
          </span>
        </div>
      </Link>

      {/* ===== Hogyan működik? — 3 lépés ===== */}
      <section id="hogyan-mukodik" style={{ padding: '48px 0', scrollMarginTop: 80 }}>
        <h2 style={{ textAlign: 'center', fontSize: 'clamp(24px, 3vw, 30px)', fontWeight: 800, marginBottom: 40 }}>
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
                  <h3 style={{ fontSize: 19, fontWeight: 800, margin: '0 0 8px' }}>{s.title}</h3>
                  <p className="muted" style={{ fontSize: 14.5, lineHeight: 1.6, margin: 0 }}>{s.desc}</p>
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ===== Feature grid ===== */}
      <section style={{ padding: '48px 0' }}>
        <h2 style={{ textAlign: 'center', fontSize: 'clamp(24px, 3vw, 30px)', fontWeight: 800, marginBottom: 12 }}>
          Minden, ami a biztonságos fuvarhoz kell
        </h2>
        <p style={{ textAlign: 'center', color: 'var(--muted)', maxWidth: 520, margin: '0 auto 40px', lineHeight: 1.5 }}>
          A GoFuvar nem csak összeköt feladót és sofőrt — végigkísér az egész
          folyamaton a feladástól a kifizetésig.
        </p>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))', gap: 16 }}>
          {FEATURES.map((f) => {
            const Icon = f.icon;
            return (
              <div key={f.title} className="card" style={{ display: 'flex', gap: 16, alignItems: 'flex-start', marginBottom: 0 }}>
                <div style={{
                  width: 48, height: 48, borderRadius: 12, flexShrink: 0,
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  background: 'color-mix(in srgb, var(--surface-hover) 60%, transparent)',
                  border: '1px solid var(--border)',
                }}>
                  <Icon size={22} color={f.tint} strokeWidth={2.2} />
                </div>
                <div>
                  <h3 style={{ fontSize: 16, fontWeight: 700, margin: '0 0 4px', display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                    {f.title}
                    {f.soon && (
                      <span style={{
                        fontSize: 11, fontWeight: 700, letterSpacing: 0.3,
                        background: 'var(--warning-light)', color: 'var(--text)',
                        border: '1px solid var(--warning)',
                        borderRadius: 999, padding: '2px 10px',
                      }}>Hamarosan</span>
                    )}
                  </h3>
                  <p className="muted" style={{ fontSize: 13, lineHeight: 1.5, margin: 0 }}>{f.desc}</p>
                </div>
              </div>
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
          <h2 style={{ textAlign: 'center', fontSize: 'clamp(24px, 3vw, 30px)', fontWeight: 800, margin: '0 0 12px', color: 'var(--success-text)' }}>
            🌿 Zöld, mert nem csinál felesleges utat
          </h2>
          <p style={{ textAlign: 'center', color: 'var(--text)', maxWidth: 620, margin: '0 auto 28px', lineHeight: 1.6 }}>
            A csomagod egy <strong>meglévő úton</strong> utazik: a sofőr úgyis megy
            A-ból B-be. Nincs külön futárautó, nincs plusz károsanyag — egy hagyományos
            kézbesítéshez képest a kibocsátás elmarad. A sofőr pedig egy úton, amit
            amúgy is megtenne, egy fuvarral <strong>hasznot termel</strong>.
          </p>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 16, maxWidth: 720, margin: '0 auto' }}>
            {[
              { big: '~43 kg', small: 'megspórolt CO₂ egy Budapest–Szeged fuvaron' },
              { big: '0', small: 'plusz futárautó — meglévő útra pakolsz' },
            ].map((s) => (
              <div key={s.small} className="card" style={{ textAlign: 'center', marginBottom: 0 }}>
                <div style={{ fontSize: 28, fontWeight: 800, color: 'var(--success-text)' }}>{s.big}</div>
                <div className="muted" style={{ fontSize: 13, lineHeight: 1.45, marginTop: 4 }}>{s.small}</div>
              </div>
            ))}
          </div>
          <p style={{ textAlign: 'center', color: 'var(--muted)', fontSize: 12.5, margin: '20px auto 0', maxWidth: 560 }}>
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
                fontSize: 22, fontWeight: 800, color: 'var(--primary-text)',
              }}>{t.stat}</span>
              <span className="muted" style={{ fontSize: 14 }}>{t.label}</span>
            </div>
          ))}
        </div>
      </section>

      {/* ===== Két szerepkör ===== */}
      <section style={{ padding: '48px 0' }}>
        <h2 style={{ textAlign: 'center', fontSize: 'clamp(24px, 3vw, 30px)', fontWeight: 800, marginBottom: 40 }}>
          Két szerepkör — egy platform
        </h2>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))', gap: 24 }}>
          {/* Csak tokenek: dark módban a tint + felület együtt sötétül, az
              ikon a -text változatot kapja (light: mély, dark: világos szín) */}
          <div style={{
            background: 'linear-gradient(135deg, var(--primary-subtle) 0%, var(--surface) 100%)',
            borderRadius: 'var(--radius-xl)', padding: 32, border: '1px solid var(--primary-light)',
          }}>
            <div style={{ display: 'inline-flex', padding: 12, borderRadius: 14, background: 'rgba(30,64,175,0.12)', marginBottom: 16 }}>
              <Package size={26} color="var(--primary-text)" />
            </div>
            <h3 style={{ fontSize: 23, fontWeight: 800, marginBottom: 12, color: 'var(--text)' }}>Feladó vagyok</h3>
            <ul style={{ margin: 0, padding: '0 0 0 20px', lineHeight: 2, color: 'var(--text)', fontSize: 15 }}>
              <li>Hirdesd meg a fuvart — a sofőrök licitálnak rá</li>
              <li>Vagy foglalj helyet egy fix áras útvonalon</li>
              <li>Kis díj után azonnal megkapod a sofőr elérhetőségét</li>
              <li>A címzett SMS-ben kapja a követési linket</li>
              <li>Add át a 6 jegyű kódot, a fuvardíjat kápéban rendezed</li>
            </ul>
          </div>
          <div style={{
            background: 'linear-gradient(135deg, var(--success-light) 0%, var(--surface) 100%)',
            borderRadius: 'var(--radius-xl)', padding: 32, border: '1px solid var(--success)',
          }}>
            <div style={{ display: 'inline-flex', padding: 12, borderRadius: 14, background: 'rgba(22,163,74,0.12)', marginBottom: 16 }}>
              <Truck size={26} color="var(--success-text)" />
            </div>
            <h3 style={{ fontSize: 23, fontWeight: 800, marginBottom: 12, color: 'var(--text)' }}>Sofőr vagyok</h3>
            <ul style={{ margin: 0, padding: '0 0 0 20px', lineHeight: 2, color: 'var(--text)', fontSize: 15 }}>
              <li>Autó, bicikli, gyalog vagy tömegközlekedés — jogosítvány nem kell</li>
              <li>Licitálj nyitott fuvarokra — a legjobb nyer</li>
              <li>Vagy hirdesd meg az utadat fix árakkal</li>
              <li>A fuvardíj 100%-a a tiéd, készpénzben — nincs levonás</li>
              <li>Igazold a felvételt és lerakodást fotóval</li>
              <li>Kérd az átvételi kódot → fuvar lezárva, a kápé a tiéd</li>
            </ul>
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
            <h2 style={{ fontSize: 'clamp(22px, 3vw, 28px)', fontWeight: 800, margin: '0 0 10px', color: 'var(--text)' }}>
              Fuvarozó cég vagy egyéni vállalkozó?
            </h2>
            <p style={{ color: 'var(--text)', margin: 0, lineHeight: 1.6, fontSize: 15.5, maxWidth: 560 }}>
              Töltsd meg az üres kilométereidet és a visszautaidat rendszeres fuvarokkal.
              A fuvardíj <strong>100%-a a tiéd, készpénzben</strong> — a platform a te
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
        <h2 style={{ fontSize: 'clamp(26px, 4vw, 32px)', fontWeight: 900, marginBottom: 16 }}>
          Kezdj el szállítani ma!
        </h2>
        <p style={{ color: 'var(--muted)', marginBottom: 32, fontSize: 16 }}>
          Regisztrálj ingyenesen, és pár perc múlva már feladhatsz egy fuvart
          vagy licitálhatsz egyre.
        </p>
        <Link href="/bejelentkezes?mode=register" className="btn"
          style={{ fontSize: 17, padding: '16px 38px', borderRadius: 12, fontWeight: 800 }}>
          Ingyenes regisztráció <ArrowRight size={18} />
        </Link>
      </section>
    </div>
  );
}
