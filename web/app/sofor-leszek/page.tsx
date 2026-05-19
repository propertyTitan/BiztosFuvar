// Sofőr-akvizíciós landing oldal.
//
// SEO: server component, statikus tartalom — Google jól indexeli.
// Jog: NINCS jövedelem-ígéret, NINCS konkurens-megnevezés, NINCS olyan
// állítás amit nem tudunk dokumentálni. Csak a platform működésének
// tényszerű leírása.
import Link from 'next/link';
import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'Sofőr leszek — GoFuvar',
  description:
    'Vállalj fuvart amikor és amennyit te szeretnél. Regisztrálj sofőrként a GoFuvar platformon, és vegyél részt nyitott fuvarok licitálásában.',
};

const STEPS = [
  {
    num: '1',
    title: 'Regisztráció',
    desc: 'Email-cím + jelszó. Megerősítő linket küldünk, és pár perc múlva már bejelentkezhetsz.',
    color: '#dbeafe',
  },
  {
    num: '2',
    title: 'KYC ellenőrzés',
    desc: 'Töltsd fel a személyi okmányod és a jogosítványod. Az ellenőrzés AI-támogatott, jellemzően gyors, de a végleges jóváhagyást az admin végzi.',
    color: '#dcfce7',
  },
  {
    num: '3',
    title: 'Nyitott fuvarok böngészése',
    desc: 'Térkép- és lista-nézetben láthatod a Feladók által meghirdetett fuvarokat. Licitálj, vagy hirdesd meg saját útvonalad fix áras helyként.',
    color: '#fef3c7',
  },
  {
    num: '4',
    title: 'Teljesítés és kifizetés',
    desc: 'A felvétel és lerakodás után a fuvardíj — a platform-díj levonását követően — automatikusan kerül a számládra (Barion utalás).',
    color: '#fce7f3',
  },
];

const REQUIREMENTS = [
  {
    icon: '🪪',
    title: 'Érvényes személyi okmány',
    desc: 'Magyar személyi igazolvány, magyar útlevél, vagy EU/EGT-ben kiadott személyi okmány.',
  },
  {
    icon: '🚗',
    title: 'Érvényes vezetői engedély',
    desc: 'A fuvarhoz használt jármű kategóriájához megfelelő, érvényes magyar vagy EU/EGT vezetői engedély.',
  },
  {
    icon: '🛡️',
    title: 'Érvényes KGFB',
    desc: 'A magyar jogszabály szerinti kötelező gépjármű-felelősségbiztosítás a használt járműhöz. A KGFB meglétéről nyilatkozni kell a regisztráció során.',
  },
  {
    icon: '👤',
    title: 'Betöltött 18. életév',
    desc: 'A KYC során életkor-ellenőrzést végzünk. A 18 év alatti felhasználók nem regisztrálhatnak sofőrként.',
  },
];

const PLATFORM_FACTS = [
  {
    icon: '🎯',
    title: 'Te állítod be a licitedet',
    desc: 'Nincs előre meghatározott díjszabás. A nyitott fuvarokra szabadon licitálhatsz, illetve fix áras útvonalakat is meghirdethetsz.',
  },
  {
    icon: '💳',
    title: 'Letét + automatikus utalás',
    desc: 'A fuvardíj a teljesítésig letétben pihen (Barion). A sikeres lezárás után — a platform-díj levonását követően — automatikusan a számládra kerül.',
  },
  {
    icon: '🔐',
    title: 'KYC-ellenőrzött Feladók',
    desc: 'A platformon kizárólag KYC-folyamaton átesett Feladók hirdethetnek fuvart. Ez csökkenti a kamuhirdetések és a fizetési viták kockázatát.',
  },
  {
    icon: '📍',
    title: 'Élő GPS-megosztás',
    desc: 'A fuvar során a pozíciód megosztható a Feladóval. Ez a Feladó és a Sofőr közötti kommunikációt és bizonyítást támogatja.',
  },
  {
    icon: '🔄',
    title: 'Visszafuvar-keresés (backhaul)',
    desc: 'A célállomáson vagy annak közelében hirdetett visszafuvar-fuvarokra automatikus értesítést kaphatsz.',
  },
  {
    icon: '⚖️',
    title: 'Belső vita-eljárás',
    desc: 'Probléma esetén (pl. átvétel megtagadása, csomag-sérülés) belső dispute-eljárás áll rendelkezésre, dokumentált bizonyítékokkal.',
  },
];

const FEES = [
  { label: 'Platform-jutalék', value: '10%' },
  { label: 'Adminisztrációs díj', value: '400 Ft / fuvar' },
  { label: 'Havidíj', value: 'Nincs' },
  { label: 'Belépési díj', value: 'Nincs' },
];

const FAQ = [
  {
    q: 'Egyéni vállalkozóként vagy magánszemélyként regisztrálhatok?',
    a: 'Mindkét formában lehetséges, de a Magyarországon érvényes adózási és jogi szabályok betartása minden esetben a Sofőr saját felelőssége. A platform díj-bevételét nem helyettesíti a magánszemély adózási kötelezettségét. Részletek az ÁSZF-ben.',
  },
  {
    q: 'Milyen járművel vállalhatok fuvart?',
    a: 'Bármilyen olyan járművel, amely jogszerűen használható az adott fuvar lebonyolítására (érvényes forgalmi, KGFB, műszaki). A jármű típusát a profilodban beállíthatod, a Feladók a saját fuvarjuknál szűrhetnek erre.',
  },
  {
    q: 'Speciális fuvar (élő állat, gyógyszer, veszélyes áru) vállalható?',
    a: 'Csak akkor, ha a Sofőr rendelkezik az adott áru szállításához szükséges engedéllyel. A Feladó felelőssége, hogy ezt a fuvar feladásakor ellenőrizze. A platform nem ellenőrzi az ilyen jellegű engedélyek meglétét.',
  },
  {
    q: 'Mi történik ha a fuvar során sérülés keletkezik?',
    a: 'A Sofőr és a Feladó közötti fuvarozási szerződésre az általános magyar és EU/EGT polgári jog vonatkozik. A platform alapértelmezett kárfelelősségi plafonja bruttó 50.000 Ft (a Feladó vagy a Sofőr emelheti). Részletek az ÁSZF kárfelelősségi szekciójában.',
  },
  {
    q: 'A platform fuvarozó cég?',
    a: 'Nem. A GoFuvar közvetítő platform a Tiszta Hód Kft. üzemeltetésében. A fuvarozási szerződés a Feladó és a Sofőr között jön létre; a platform nem fuvarozó és nem szállítmányozó.',
  },
];

export default function SoforLeszek() {
  return (
    <div style={{ maxWidth: 1100, margin: '0 auto', padding: '0 16px' }}>
      {/* ===== Hero ===== */}
      <section style={{ textAlign: 'center', padding: '64px 0 48px' }}>
        <div
          style={{
            display: 'inline-block',
            background: 'linear-gradient(135deg, #16a34a 0%, #4ade80 100%)',
            color: '#fff',
            padding: '6px 16px',
            borderRadius: 999,
            fontSize: 13,
            fontWeight: 700,
            marginBottom: 24,
            letterSpacing: 0.5,
          }}
        >
          🚛 Sofőröknek
        </div>
        <h1
          style={{
            fontSize: 'clamp(32px, 5vw, 56px)',
            fontWeight: 900,
            lineHeight: 1.1,
            margin: '0 auto 20px',
            maxWidth: 740,
            letterSpacing: '-1px',
          }}
        >
          Vállalj fuvart{' '}
          <span style={{ color: '#16a34a' }}>amikor és amennyit szeretnél</span>
        </h1>
        <p
          style={{
            fontSize: 'clamp(16px, 2vw, 20px)',
            color: 'var(--muted)',
            maxWidth: 620,
            margin: '0 auto 32px',
            lineHeight: 1.5,
          }}
        >
          Regisztrálj sofőrként a GoFuvar platformon, és vegyél részt
          KYC-ellenőrzött Feladók által meghirdetett fuvarok licitálásában.
          A díjazásodat te határozod meg.
        </p>
        <div style={{ display: 'flex', gap: 12, justifyContent: 'center', flexWrap: 'wrap' }}>
          <Link
            href="/bejelentkezes?mode=register"
            className="btn"
            style={{
              fontSize: 17,
              padding: '14px 32px',
              borderRadius: 12,
              fontWeight: 800,
              background: 'linear-gradient(135deg, #16a34a 0%, #4ade80 100%)',
              boxShadow: '0 6px 20px rgba(22,163,74,0.35)',
            }}
          >
            Sofőr-regisztráció →
          </Link>
          <Link
            href="/aszf"
            className="btn btn-secondary"
            style={{ fontSize: 17, padding: '14px 32px', borderRadius: 12 }}
          >
            ÁSZF megtekintése
          </Link>
        </div>
        <p style={{ fontSize: 12, color: 'var(--muted)', marginTop: 16 }}>
          Ingyenes regisztráció · Nincs havidíj · Platform-díjat csak sikeres
          fuvar után számolunk fel
        </p>
      </section>

      {/* ===== Hogyan működik? ===== */}
      <section style={{ padding: '48px 0' }}>
        <h2
          style={{
            textAlign: 'center',
            fontSize: 28,
            fontWeight: 800,
            marginBottom: 40,
          }}
        >
          Hogyan működik?
        </h2>
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))',
            gap: 20,
          }}
        >
          {STEPS.map((s) => (
            <div
              key={s.num}
              className="on-light"
              style={{
                background: s.color,
                borderRadius: 20,
                padding: 28,
                position: 'relative',
                overflow: 'hidden',
              }}
            >
              <div
                style={{
                  position: 'absolute',
                  top: -10,
                  right: -10,
                  fontSize: 100,
                  fontWeight: 900,
                  opacity: 0.1,
                  lineHeight: 1,
                  color: '#0f172a',
                }}
              >
                {s.num}
              </div>
              <div
                style={{
                  width: 44,
                  height: 44,
                  borderRadius: 12,
                  background: 'rgba(0,0,0,0.08)',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  fontSize: 22,
                  fontWeight: 900,
                  marginBottom: 16,
                  color: '#0f172a',
                }}
              >
                {s.num}
              </div>
              <h3 style={{ fontSize: 20, fontWeight: 800, marginBottom: 8, color: '#0f172a' }}>
                {s.title}
              </h3>
              <p style={{ fontSize: 14, lineHeight: 1.6, color: '#334155', margin: 0 }}>
                {s.desc}
              </p>
            </div>
          ))}
        </div>
      </section>

      {/* ===== Mit kell hozzá? ===== */}
      <section style={{ padding: '48px 0' }}>
        <h2
          style={{
            textAlign: 'center',
            fontSize: 28,
            fontWeight: 800,
            marginBottom: 12,
          }}
        >
          Mit kell hozzá?
        </h2>
        <p
          style={{
            textAlign: 'center',
            color: 'var(--muted)',
            maxWidth: 580,
            margin: '0 auto 40px',
            lineHeight: 1.5,
          }}
        >
          A regisztrációhoz az alábbi dokumentumok és feltételek szükségesek.
          A KYC-folyamat során ezeket ellenőrizzük.
        </p>
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))',
            gap: 16,
          }}
        >
          {REQUIREMENTS.map((r) => (
            <div
              key={r.title}
              style={{
                background: 'var(--surface)',
                border: '1px solid var(--border)',
                borderRadius: 16,
                padding: 24,
                display: 'flex',
                gap: 16,
                alignItems: 'flex-start',
              }}
            >
              <div
                style={{
                  width: 48,
                  height: 48,
                  borderRadius: 12,
                  background: 'var(--surface)',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  fontSize: 24,
                  flexShrink: 0,
                }}
              >
                {r.icon}
              </div>
              <div>
                <h3 style={{ fontSize: 16, fontWeight: 700, marginBottom: 4 }}>
                  {r.title}
                </h3>
                <p style={{ fontSize: 13, color: 'var(--muted)', lineHeight: 1.5, margin: 0 }}>
                  {r.desc}
                </p>
              </div>
            </div>
          ))}
        </div>
      </section>

      {/* ===== Platform funkciók (csak tények) ===== */}
      <section style={{ padding: '48px 0' }}>
        <h2
          style={{
            textAlign: 'center',
            fontSize: 28,
            fontWeight: 800,
            marginBottom: 12,
          }}
        >
          Amit a platform kínál
        </h2>
        <p
          style={{
            textAlign: 'center',
            color: 'var(--muted)',
            maxWidth: 580,
            margin: '0 auto 40px',
            lineHeight: 1.5,
          }}
        >
          Ezek a funkciók a fuvar-folyamatot támogatják a regisztrációtól
          a kifizetésig.
        </p>
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))',
            gap: 16,
          }}
        >
          {PLATFORM_FACTS.map((f) => (
            <div
              key={f.title}
              style={{
                background: 'var(--surface)',
                border: '1px solid var(--border)',
                borderRadius: 16,
                padding: 24,
                display: 'flex',
                gap: 16,
                alignItems: 'flex-start',
              }}
            >
              <div
                style={{
                  width: 48,
                  height: 48,
                  borderRadius: 12,
                  background: 'var(--surface)',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  fontSize: 24,
                  flexShrink: 0,
                }}
              >
                {f.icon}
              </div>
              <div>
                <h3 style={{ fontSize: 16, fontWeight: 700, marginBottom: 4 }}>
                  {f.title}
                </h3>
                <p style={{ fontSize: 13, color: 'var(--muted)', lineHeight: 1.5, margin: 0 }}>
                  {f.desc}
                </p>
              </div>
            </div>
          ))}
        </div>
      </section>

      {/* ===== Díjak ===== */}
      <section style={{ padding: '48px 0' }}>
        <h2
          style={{
            textAlign: 'center',
            fontSize: 28,
            fontWeight: 800,
            marginBottom: 12,
          }}
        >
          Platform-díjak
        </h2>
        <p
          style={{
            textAlign: 'center',
            color: 'var(--muted)',
            maxWidth: 620,
            margin: '0 auto 32px',
            lineHeight: 1.5,
          }}
        >
          A díjazást a Sofőr a saját licitjében határozza meg. A platform a
          sikeresen teljesített fuvarok után számít fel díjat.
        </p>
        <div
          style={{
            maxWidth: 520,
            margin: '0 auto',
            background: 'var(--surface)',
            border: '1px solid var(--border)',
            borderRadius: 16,
            padding: 8,
          }}
        >
          {FEES.map((f, i) => (
            <div
              key={f.label}
              style={{
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
                padding: '16px 20px',
                borderTop: i === 0 ? 'none' : '1px solid var(--border)',
              }}
            >
              <span style={{ fontSize: 15 }}>{f.label}</span>
              <span style={{ fontSize: 16, fontWeight: 700, color: '#1e40af' }}>
                {f.value}
              </span>
            </div>
          ))}
        </div>
        <p
          style={{
            textAlign: 'center',
            fontSize: 12,
            color: 'var(--muted)',
            marginTop: 16,
            maxWidth: 620,
            marginLeft: 'auto',
            marginRight: 'auto',
            lineHeight: 1.5,
          }}
        >
          Példa: 15.000 Ft elfogadott licit → platform-díj 10% + 400 Ft = 1.900 Ft →
          a Sofőr számlájára 13.100 Ft kerül utalásra. A pontos elszámolási
          szabályokat az ÁSZF tartalmazza.
        </p>
      </section>

      {/* ===== GYIK ===== */}
      <section style={{ padding: '48px 0' }}>
        <h2
          style={{
            textAlign: 'center',
            fontSize: 28,
            fontWeight: 800,
            marginBottom: 40,
          }}
        >
          Gyakori kérdések
        </h2>
        <div style={{ maxWidth: 760, margin: '0 auto' }}>
          {FAQ.map((item) => (
            <details
              key={item.q}
              style={{
                background: 'var(--surface)',
                border: '1px solid var(--border)',
                borderRadius: 12,
                padding: '16px 20px',
                marginBottom: 12,
              }}
            >
              <summary
                style={{
                  cursor: 'pointer',
                  fontWeight: 700,
                  fontSize: 15,
                }}
              >
                {item.q}
              </summary>
              <p
                style={{
                  marginTop: 12,
                  marginBottom: 0,
                  fontSize: 14,
                  lineHeight: 1.6,
                  color: 'var(--muted)',
                }}
              >
                {item.a}
              </p>
            </details>
          ))}
        </div>
      </section>

      {/* ===== CTA ===== */}
      <section
        style={{
          textAlign: 'center',
          padding: '64px 0',
          borderTop: '1px solid var(--border)',
        }}
      >
        <h2 style={{ fontSize: 32, fontWeight: 900, marginBottom: 16 }}>
          Kezdjünk neki?
        </h2>
        <p style={{ color: 'var(--muted)', marginBottom: 32, fontSize: 16 }}>
          Regisztrálj ingyenesen, és a KYC-jóváhagyás után már licitálhatsz
          a nyitott fuvarokra.
        </p>
        <Link
          href="/bejelentkezes?mode=register"
          className="btn"
          style={{
            fontSize: 18,
            padding: '16px 40px',
            borderRadius: 12,
            fontWeight: 800,
            background: 'linear-gradient(135deg, #16a34a 0%, #4ade80 100%)',
            boxShadow: '0 6px 20px rgba(22,163,74,0.35)',
          }}
        >
          Sofőr-regisztráció →
        </Link>
      </section>

      {/* ===== Jogi lábjegyzet ===== */}
      <section
        style={{
          padding: '24px 0 48px',
          borderTop: '1px solid var(--border)',
        }}
      >
        <p
          style={{
            fontSize: 12,
            color: 'var(--muted)',
            lineHeight: 1.6,
            margin: 0,
            textAlign: 'center',
            maxWidth: 760,
            marginLeft: 'auto',
            marginRight: 'auto',
          }}
        >
          A GoFuvar közvetítő platform a Tiszta Hód Kft. (székhely: 6800
          Hódmezővásárhely, Szántó Kovács János utca 144., cégjegyzékszám:
          06-09-020646) üzemeltetésében. A fuvarozási szerződés a Feladó és
          a Sofőr között jön létre — a platform nem fuvarozó és nem
          szállítmányozó. A teljes feltételrendszer az{' '}
          <Link href="/aszf" style={{ color: '#1e40af', textDecoration: 'underline' }}>
            ÁSZF-ben
          </Link>{' '}
          és az{' '}
          <Link href="/adatkezeles" style={{ color: '#1e40af', textDecoration: 'underline' }}>
            Adatkezelési tájékoztatóban
          </Link>{' '}
          található.
        </p>
      </section>
    </div>
  );
}
