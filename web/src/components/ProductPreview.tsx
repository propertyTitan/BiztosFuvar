// Termék-előnézet a landing hero-jába — telefon-keretben a GoFuvar
// kulcspillanata: a feladott fuvarra érkeznek a sofőr-ajánlatok.
//
// SZÁNDÉKOSAN nem screenshot-PNG, hanem token-alapú, "élő" mini-UI:
//  - a dark mode-dal együtt vált (a PNG nem tudná),
//  - mindig éles (retina, zoom),
//  - a valódi termék-szókincset használja ("Ajánlatokat vár", pill-ek,
//    átvételi kód) — a hero ígéretét ("Sofőröd is lesz.") játssza el:
//    a harmadik, legjobb ajánlat kis késleltetéssel "érkezik meg"
//    (gofuvar-offer-in a globals.css-ben, reduced-motion-nel kikapcsol).
//
// A tartalom illusztráció (fiktív nevek/árak), ezért role="img" + felirat,
// a belseje pedig aria-hidden — a felolvasó egy mondatot kap, nem 30 morzsát.
import { Bell, Star, KeyRound } from 'lucide-react';

// Mini ajánlat-sor a mock-képernyőn
function Offer({
  monogram, name, rating, trips, price, arriving,
}: {
  monogram: string; name: string; rating: string; trips: number;
  price: string; arriving?: boolean;
}) {
  return (
    <div
      className={arriving ? 'pp-offer-in' : undefined}
      style={{
        display: 'flex', alignItems: 'center', gap: 8,
        background: 'var(--surface)', border: `1px solid ${arriving ? 'var(--primary-light)' : 'var(--border)'}`,
        borderRadius: 10, padding: '8px 10px', position: 'relative',
        boxShadow: arriving ? '0 4px 14px rgba(37,99,235,0.14)' : 'none',
      }}
    >
      {/* rgba-tint és nem var(--primary-subtle): a globals.css
          [style*="--primary-subtle"] dark-mode szabálya !important-tal
          felülírná a monogram színét */}
      <div style={{
        width: 26, height: 26, borderRadius: '50%', flexShrink: 0,
        background: 'rgba(37,99,235,0.14)', color: 'var(--primary-text)',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        fontSize: 9.5, fontWeight: 800, letterSpacing: 0.3,
      }}>{monogram}</div>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: 11.5, fontWeight: 700, color: 'var(--text)', lineHeight: 1.3 }}>{name}</div>
        <div style={{
          fontSize: 9.5, color: 'var(--muted)',
          display: 'flex', alignItems: 'center', gap: 3, lineHeight: 1.3,
        }}>
          <Star size={9} color="var(--warning)" fill="var(--warning)" style={{ flexShrink: 0 }} />
          {rating} · {trips} fuvar
        </div>
      </div>
      <div style={{ fontSize: 12, fontWeight: 800, color: 'var(--primary-text)', whiteSpace: 'nowrap' }}>
        {price}
      </div>
      {arriving && (
        <span style={{
          position: 'absolute', top: -7, right: 8,
          background: 'var(--primary)', color: '#fff',
          fontSize: 8.5, fontWeight: 800, letterSpacing: 0.4,
          borderRadius: 999, padding: '2px 7px', textTransform: 'uppercase',
        }}>Új</span>
      )}
    </div>
  );
}

export default function ProductPreview() {
  return (
    <div
      role="img"
      aria-label="A GoFuvar alkalmazás képernyője: egy feladott Budapest–Szeged fuvarra három sofőr tett ajánlatot."
      style={{ position: 'relative', display: 'flex', justifyContent: 'center', marginTop: 48 }}
    >
      <div aria-hidden style={{ position: 'relative' }}>
        {/* Lágy fény a telefon mögött — a hero mesh folytatása */}
        <div style={{
          position: 'absolute', inset: '-8% -22%', zIndex: -1,
          background: 'radial-gradient(50% 50% at 50% 45%, rgba(59,130,246,0.16) 0%, rgba(59,130,246,0) 72%)',
          pointerEvents: 'none',
        }} />

        {/* ── Telefon-keret ── */}
        <div style={{
          width: 296, borderRadius: 44, padding: 9,
          background: '#0b1120',
          boxShadow: '0 0 0 1px rgba(148,163,184,0.18), 0 26px 60px rgba(2,6,23,0.35)',
        }}>
          <div style={{
            borderRadius: 36, overflow: 'hidden', background: 'var(--bg)',
            border: '1px solid var(--border)', position: 'relative',
          }}>
            {/* Dynamic island */}
            <div style={{
              position: 'absolute', top: 8, left: '50%', transform: 'translateX(-50%)',
              width: 76, height: 19, borderRadius: 999, background: '#0b1120', zIndex: 2,
            }} />

            {/* Mini app-fejléc — a valódi .site-header kék gradiense */}
            <div style={{
              background: 'linear-gradient(135deg, rgba(30,64,175,0.97) 0%, rgba(37,99,235,0.95) 100%)',
              padding: '34px 16px 12px',
              display: 'flex', alignItems: 'center', justifyContent: 'space-between',
            }}>
              <span style={{
                fontFamily: 'var(--font-display), var(--font-inter), sans-serif',
                fontSize: 14, fontWeight: 800, color: '#fff', letterSpacing: 0.2,
              }}>GoFuvar</span>
              <span style={{ position: 'relative', display: 'inline-flex' }}>
                <Bell size={14} color="#fff" />
                <span style={{
                  position: 'absolute', top: -4, right: -6,
                  background: '#f87171', color: '#fff', fontSize: 7.5, fontWeight: 800,
                  borderRadius: 999, padding: '1px 4px', lineHeight: 1.4,
                }}>3</span>
              </span>
            </div>

            {/* Képernyő-tartalom */}
            <div style={{ padding: 12, display: 'flex', flexDirection: 'column', gap: 10 }}>

              {/* Fuvar-kártya a márka útvonal-motívumával */}
              <div style={{
                background: 'var(--surface)', border: '1px solid var(--border)',
                borderRadius: 12, padding: 12,
              }}>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
                  <span style={{ fontSize: 13, fontWeight: 800, color: 'var(--text)' }}>IKEA PAX szekrény</span>
                  {/* A valódi termék státusz-pillje (osztályból, kicsinyítve) */}
                  <span className="pill pill-bidding" style={{
                    fontSize: 9, padding: '3px 8px', whiteSpace: 'nowrap', letterSpacing: 0.2,
                  }}>Ajánlatokat vár</span>
                </div>
                {/* A→B: kék pont = feladás, zöld = kézbesítés (mint a heróban) */}
                <div style={{ display: 'flex', alignItems: 'center', gap: 6, margin: '12px 0 4px' }}>
                  <span style={{ width: 7, height: 7, borderRadius: '50%', background: 'var(--primary)', flexShrink: 0 }} />
                  <span style={{
                    flex: 1, height: 2,
                    backgroundImage: 'radial-gradient(circle, var(--primary-light) 1.2px, transparent 1.4px)',
                    backgroundSize: '8px 2px', backgroundRepeat: 'repeat-x', opacity: 0.7,
                  }} />
                  <span style={{ width: 7, height: 7, borderRadius: '50%', background: 'var(--success)', flexShrink: 0 }} />
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 10.5, fontWeight: 700, color: 'var(--text)' }}>
                  <span>Budapest</span>
                  <span>Szeged</span>
                </div>
                <div style={{ fontSize: 10, color: 'var(--muted)', marginTop: 6 }}>
                  45 kg · holnap · 171 km
                </div>
              </div>

              {/* Ajánlatok */}
              <div style={{
                fontSize: 9.5, fontWeight: 800, letterSpacing: 1, textTransform: 'uppercase',
                color: 'var(--muted)', margin: '2px 2px 0',
              }}>
                Ajánlatok · 3
              </div>
              <Offer monogram="KP" name="Kovács P." rating="4,9" trips={132} price="9 500 Ft" />
              <Offer monogram="SA" name="Szabó A." rating="5,0" trips={78} price="10 200 Ft" />
              <Offer monogram="TG" name="Tóth G." rating="4,8" trips={214} price="8 900 Ft" arriving />
              {/* Üres sáv: ide (és a kávára) ül a lebegő kód-chip, hogy
                  ne takarjon ajánlatot */}
              <div style={{ height: 34 }} />
            </div>
          </div>
        </div>

        {/* Lebegő átvételi kód-chip — a másik bizalmi USP (keskeny képernyőn
            rejtve; az alsó üres sávra ül, ajánlatot nem takar) */}
        <div className="pp-code-chip" style={{
          position: 'absolute', right: -70, bottom: 8,
          background: 'var(--surface)', border: '1px solid var(--border)',
          borderRadius: 14, padding: '10px 14px', boxShadow: 'var(--shadow-lg)',
          transform: 'rotate(3deg)',
          display: 'flex', alignItems: 'center', gap: 10,
        }}>
          <span style={{
            display: 'inline-flex', padding: 7, borderRadius: 10,
            background: 'var(--warning-light)', flexShrink: 0,
          }}>
            <KeyRound size={15} color="var(--warning)" />
          </span>
          <span>
            <span style={{ display: 'block', fontSize: 9, fontWeight: 700, letterSpacing: 0.8, textTransform: 'uppercase', color: 'var(--muted)' }}>
              Átvételi kód
            </span>
            <span style={{
              display: 'block', fontFamily: 'var(--font-display), var(--font-inter), sans-serif',
              fontSize: 15, fontWeight: 800, letterSpacing: 3, color: 'var(--text)',
            }}>
              482 915
            </span>
          </span>
        </div>
      </div>
    </div>
  );
}
