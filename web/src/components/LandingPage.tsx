'use client';

// GoFuvar marketing landing page – a bejelentkezés nélküli főoldal.
//
// SEO célok:
//  - Elmagyarázza mi a GoFuvar (közösségi fuvartőzsde)
//  - Feature highlight (licit, fix áras, élő követés, Barion letét, fotó)
//  - Bizalomépítő szekciók ("Hogyan működik?", 3 lépés)
//  - CTA gombok a regisztrációhoz / belépéshez
//
// 'use client' azért kell, mert a useCurrentUser hook-kal döntjük el
// megjelenjen-e egyáltalán. Ha a user be van lépve, null-t adunk vissza.
import Link from 'next/link';
import { useCurrentUser } from '@/lib/auth';

const FEATURES = [
  {
    icon: '🎯',
    title: 'Licitálható fuvarok',
    desc: 'Hirdesd meg a csomagodat, és a sofőrök licitálnak rá. Te döntöd el melyik ajánlatot fogadod el.',
  },
  {
    icon: '🛣️',
    title: 'Fix áras útvonalak',
    desc: 'A sofőrök meghirdetik az útjukat és fix árat szabnak. Foglalj helyet a csomagod számára egyetlen kattintással.',
  },
  {
    icon: '📍',
    title: 'Élő GPS követés',
    desc: 'A fuvar elindulása után valós időben követheted a sofőröd pozícióját a térképen.',
  },
  {
    icon: '💳',
    title: 'Barion letét (Escrow)',
    desc: 'A fuvardíj a Barion letétben pihen, amíg a csomag bizonyítottan megérkezik. Biztonságos mindkét félnek.',
  },
  {
    icon: '📸',
    title: 'Fotó bizonyíték',
    desc: 'A sofőr felvételi és lerakodási fotóval igazolja a csomag állapotát. AI ellenőrzés automatikusan.',
  },
  {
    icon: '🔐',
    title: '6 jegyű átvételi kód',
    desc: 'A fuvar lezárásához a sofőrnek be kell írnia a feladó 6 jegyű kódját. Nincs kód — nincs kifizetés.',
  },
];

const STEPS = [
  {
    num: '1',
    title: 'Hirdesd meg a fuvart',
    desc: 'Add meg a felvételi és lerakodási címet, a csomag méreteit és a javasolt árat. Fotót is csatolhatsz.',
    color: '#dbeafe',
  },
  {
    num: '2',
    title: 'Válassz sofőrt',
    desc: 'Fogadd el a legjobb licitet, vagy foglalj helyet egy útba eső sofőr fix áras útvonalán. Fizesd ki biztonságosan a Barion letétbe.',
    color: '#dcfce7',
  },
  {
    num: '3',
    title: 'Kövesd és vedd át',
    desc: 'Kövesd a sofőröd élőben a térképen. Az átvételkor add át a 6 jegyű kódot — a sofőr kifizetése automatikus.',
    color: '#fef3c7',
  },
];

const TRUST = [
  { stat: '10%', label: 'platform jutalék — a sofőr 90%-ot kap' },
  { stat: '100%', label: 'visszatérítés ha a sofőr mondja le' },
  { stat: '6 jegyű', label: 'átvételi kód biztosítja a lezárást' },
  { stat: '24/7', label: 'AI segéd válaszol a kérdéseidre' },
];

export default function LandingPage() {
  const user = useCurrentUser();
  // Ha be van lépve, ne jelenjen meg a landing — a HomeHub kártyákat mutat.
  if (user) return null;

  return (
    <div style={{ maxWidth: 1100, margin: '0 auto', padding: '0 16px' }}>

      {/* ===== Hero ===== */}
      <section
        style={{
          textAlign: 'center',
          padding: '64px 0 48px',
        }}
      >
        <div
          style={{
            display: 'inline-block',
            background: 'linear-gradient(135deg, #1e40af 0%, #3b82f6 100%)',
            color: '#fff',
            padding: '6px 16px',
            borderRadius: 999,
            fontSize: 13,
            fontWeight: 700,
            marginBottom: 24,
            letterSpacing: 0.5,
          }}
        >
          🇭🇺 Magyarország közösségi fuvartőzsdéje
        </div>
        <h1
          style={{
            fontSize: 'clamp(32px, 5vw, 56px)',
            fontWeight: 900,
            lineHeight: 1.1,
            margin: '0 auto 20px',
            maxWidth: 700,
            letterSpacing: '-1px',
          }}
        >
          Csomagod van?{' '}
          <span style={{ color: '#1e40af' }}>Sofőröd is lesz.</span>
        </h1>
        <p
          style={{
            fontSize: 'clamp(16px, 2vw, 20px)',
            color: 'var(--muted)',
            maxWidth: 580,
            margin: '0 auto 32px',
            lineHeight: 1.5,
          }}
        >
          Hirdess meg egy fuvart és a sofőrök licitálnak rá — vagy foglalj
          helyet egy útba eső sofőr fix áras útvonalán. Biztonságos fizetés,
          élő követés, fotó bizonyíték.
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
              background: 'linear-gradient(135deg, #1e40af 0%, #3b82f6 100%)',
              boxShadow: '0 6px 20px rgba(30,64,175,0.35)',
            }}
          >
            Regisztráció / Belépés →
          </Link>
        </div>
        <p
          style={{
            fontSize: 12,
            color: 'var(--muted)',
            marginTop: 16,
          }}
        >
          Ingyenes regisztráció · Nincs havidíj · Csak sikeres fuvar után fizetsz
        </p>
      </section>

      {/* ===== Hogyan működik? — 3 lépés ===== */}
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
            gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))',
            gap: 24,
          }}
        >
          {STEPS.map((s) => (
            <div
              key={s.num}
              className="on-light"
              style={{
                background: s.color,
                borderRadius: 20,
                padding: 32,
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
                }}
              >
                {s.num}
              </div>
              <h3 style={{ fontSize: 22, fontWeight: 800, marginBottom: 8, color: '#0f172a' }}>
                {s.title}
              </h3>
              <p style={{ fontSize: 15, lineHeight: 1.6, color: '#334155', margin: 0 }}>
                {s.desc}
              </p>
            </div>
          ))}
        </div>
      </section>

      {/* ===== Feature grid ===== */}
      <section style={{ padding: '48px 0' }}>
        <h2
          style={{
            textAlign: 'center',
            fontSize: 28,
            fontWeight: 800,
            marginBottom: 12,
          }}
        >
          Minden, ami a biztonságos fuvarhoz kell
        </h2>
        <p
          style={{
            textAlign: 'center',
            color: 'var(--muted)',
            maxWidth: 520,
            margin: '0 auto 40px',
            lineHeight: 1.5,
          }}
        >
          A GoFuvar nem csak összeköt feladót és sofőrt — végigkísér az egész
          folyamaton a feladástól a kifizetésig.
        </p>
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))',
            gap: 16,
          }}
        >
          {FEATURES.map((f) => (
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

      {/* ===== Trust / számok ===== */}
      <section
        style={{
          padding: '48px 0',
          borderTop: '1px solid var(--border)',
        }}
      >
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))',
            gap: 24,
            textAlign: 'center',
          }}
        >
          {TRUST.map((t) => (
            <div key={t.label}>
              <div
                style={{
                  fontSize: 36,
                  fontWeight: 900,
                  color: '#1e40af',
                  lineHeight: 1,
                  marginBottom: 8,
                }}
              >
                {t.stat}
              </div>
              <div style={{ fontSize: 14, color: 'var(--muted)' }}>{t.label}</div>
            </div>
          ))}
        </div>
      </section>

      {/* ===== Két szerepkör ===== */}
      <section style={{ padding: '48px 0' }}>
        <h2
          style={{
            textAlign: 'center',
            fontSize: 28,
            fontWeight: 800,
            marginBottom: 40,
          }}
        >
          Két szerepkör — egy platform
        </h2>
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))',
            gap: 24,
          }}
        >
          <div
            className="on-light"
            style={{
              background: 'linear-gradient(135deg, #dbeafe 0%, #eff6ff 100%)',
              borderRadius: 20,
              padding: 32,
              border: '1px solid #93c5fd',
            }}
          >
            <div style={{ fontSize: 40, marginBottom: 16 }}>📦</div>
            <h3 style={{ fontSize: 24, fontWeight: 800, marginBottom: 12, color: '#0f172a' }}>
              Feladó vagyok
            </h3>
            <ul style={{ margin: 0, padding: '0 0 0 20px', lineHeight: 2, color: '#1e293b', fontSize: 15 }}>
              <li>Hirdesd meg a fuvart — a sofőrök licitálnak rá</li>
              <li>Vagy foglalj helyet egy fix áras útvonalon</li>
              <li>Fizess biztonságosan a Barion letétbe</li>
              <li>Kövesd élőben a sofőröd a térképen</li>
              <li>Add át a 6 jegyű kódot az átvételkor</li>
            </ul>
          </div>
          <div
            className="on-light"
            style={{
              background: 'linear-gradient(135deg, #dcfce7 0%, #f0fdf4 100%)',
              borderRadius: 20,
              padding: 32,
              border: '1px solid #86efac',
            }}
          >
            <div style={{ fontSize: 40, marginBottom: 16 }}>🚛</div>
            <h3 style={{ fontSize: 24, fontWeight: 800, marginBottom: 12, color: '#0f172a' }}>
              Sofőr vagyok
            </h3>
            <ul style={{ margin: 0, padding: '0 0 0 20px', lineHeight: 2, color: '#1e293b', fontSize: 15 }}>
              <li>Licitálj nyitott fuvarokra — a legjobb nyer</li>
              <li>Vagy hirdesd meg az utadat fix árakkal</li>
              <li>A fuvardíj 90%-a a tiéd (10% platform jutalék)</li>
              <li>Igazold a felvételt és lerakodást fotóval</li>
              <li>Kérd az átvételi kódot → automatikus kifizetés</li>
            </ul>
          </div>
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
          Kezdj el szállítani ma!
        </h2>
        <p style={{ color: 'var(--muted)', marginBottom: 32, fontSize: 16 }}>
          Regisztrálj ingyenesen, és pár perc múlva már feladhatsz egy fuvart
          vagy licitálhatsz egyre.
        </p>
        <Link
          href="/bejelentkezes?mode=register"
          className="btn"
          style={{
            fontSize: 18,
            padding: '16px 40px',
            borderRadius: 12,
            fontWeight: 800,
            background: 'linear-gradient(135deg, #1e40af 0%, #3b82f6 100%)',
            boxShadow: '0 6px 20px rgba(30,64,175,0.35)',
          }}
        >
          Ingyenes regisztráció →
        </Link>
      </section>
    </div>
  );
}
