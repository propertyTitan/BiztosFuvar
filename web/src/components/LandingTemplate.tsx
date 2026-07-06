// Egy landing-oldal megjelenítése EGY LandingConfig-ból (lib/landings.ts).
// Statikus tartalom → server component, SEO-barát, nem kell hozzá JS.
import Link from 'next/link';
import type { LandingConfig } from '@/lib/landings';
import { greenStats } from '@/lib/green';

export default function LandingTemplate({ config }: { config: LandingConfig }) {
  const green = config.route ? greenStats(config.route.distanceKm) : null;

  // FAQ rich-result JSON-LD (Google kiemelt találat a kérdésekre).
  const faqJsonLd = config.faq && config.faq.length > 0 ? {
    '@context': 'https://schema.org',
    '@type': 'FAQPage',
    mainEntity: config.faq.map((f) => ({
      '@type': 'Question',
      name: f.q,
      acceptedAnswer: { '@type': 'Answer', text: f.a },
    })),
  } : null;

  return (
    <div style={{ maxWidth: 900, margin: '0 auto' }}>
      {faqJsonLd && (
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{ __html: JSON.stringify(faqJsonLd) }}
        />
      )}
      {/* ── Hero ── */}
      <section style={{ textAlign: 'center', padding: '56px 0 40px' }}>
        {config.eyebrow && (
          <div style={{
            display: 'inline-block', fontSize: 12, fontWeight: 700, letterSpacing: 0.5,
            textTransform: 'uppercase', color: 'var(--primary-text)',
            background: 'var(--primary-subtle)', borderRadius: 999, padding: '4px 12px', marginBottom: 16,
          }}>
            {config.eyebrow}
          </div>
        )}
        <h1 style={{ fontSize: 'clamp(28px, 5vw, 44px)', fontWeight: 800, lineHeight: 1.15, margin: '0 0 16px' }}>
          {config.headline}
        </h1>
        <p style={{ fontSize: 'clamp(16px, 2vw, 19px)', color: 'var(--muted)', maxWidth: 620, margin: '0 auto 28px', lineHeight: 1.6 }}>
          {config.subhead}
        </p>
        <div style={{ display: 'flex', gap: 12, justifyContent: 'center', flexWrap: 'wrap' }}>
          <Link href={config.primaryCta.href} className="btn" style={{ textDecoration: 'none', fontSize: 16, padding: '12px 24px' }}>
            {config.primaryCta.label}
          </Link>
          <Link href="/" className="btn btn-ghost" style={{ textDecoration: 'none', fontSize: 16, padding: '12px 24px' }}>
            Hogyan működik?
          </Link>
        </div>
      </section>

      {/* ── Zöld / útvonal-stat blokk (csak útvonal-oldalon) ── */}
      {green && config.route && (
        <section style={{ padding: '8px 0 40px' }}>
          <div
            className="card"
            style={{
              background: 'var(--success-light)', border: '1px solid var(--success)',
              display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))',
              gap: 16, textAlign: 'center', marginBottom: 0,
            }}
          >
            <div>
              <div style={{ fontSize: 26, fontWeight: 800, color: 'var(--success-text)' }}>{config.route.distanceKm} km</div>
              <div className="muted" style={{ fontSize: 13 }}>{config.route.fromCity}–{config.route.toCity} táv</div>
            </div>
            <div>
              <div style={{ fontSize: 26, fontWeight: 800, color: 'var(--success-text)' }}>~{green.co2SavedKg} kg</div>
              <div className="muted" style={{ fontSize: 13 }}>megspórolt CO₂ egy meglévő úton</div>
            </div>
            <div>
              <div style={{ fontSize: 26, fontWeight: 800, color: 'var(--success-text)' }}>0</div>
              <div className="muted" style={{ fontSize: 13 }}>plusz futárautó — meglévő útra pakolsz</div>
            </div>
          </div>
        </section>
      )}

      {/* ── Érték-pontok ── */}
      <section style={{ padding: '8px 0 40px' }}>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))', gap: 16 }}>
          {config.bullets.map((b) => (
            <div key={b.title} className="card" style={{ marginBottom: 0 }}>
              <h3 style={{ fontSize: 16, fontWeight: 700, margin: '0 0 6px', display: 'flex', gap: 8, alignItems: 'center' }}>
                {b.icon && <span aria-hidden>{b.icon}</span>}{b.title}
              </h3>
              <p className="muted" style={{ fontSize: 14, lineHeight: 1.55, margin: 0 }}>{b.desc}</p>
            </div>
          ))}
        </div>
      </section>

      {/* ── GYIK ── */}
      {config.faq && config.faq.length > 0 && (
        <section style={{ padding: '8px 0 40px' }}>
          <h2 style={{ fontSize: 'clamp(22px, 3vw, 28px)', fontWeight: 800, textAlign: 'center', marginBottom: 24 }}>
            Gyakori kérdések
          </h2>
          <div style={{ maxWidth: 680, margin: '0 auto', display: 'flex', flexDirection: 'column', gap: 12 }}>
            {config.faq.map((f) => (
              <div key={f.q} className="card" style={{ marginBottom: 0 }}>
                <h3 style={{ fontSize: 15.5, fontWeight: 700, margin: '0 0 6px' }}>{f.q}</h3>
                <p className="muted" style={{ fontSize: 14, lineHeight: 1.55, margin: 0 }}>{f.a}</p>
              </div>
            ))}
          </div>
        </section>
      )}

      {/* ── Záró CTA ── */}
      <section style={{ padding: '16px 0 56px', textAlign: 'center' }}>
        <Link href={config.primaryCta.href} className="btn" style={{ textDecoration: 'none', fontSize: 16, padding: '14px 28px' }}>
          {config.primaryCta.label}
        </Link>
      </section>
    </div>
  );
}
