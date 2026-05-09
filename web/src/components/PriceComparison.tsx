'use client';

// =====================================================================
//  Ár-összehasonlító — GoFuvar vs GLS vs MPL vs Foxpost.
//
//  A nyilvános árlisták alapján számolt FIX képlet. Nem 100% pontos,
//  de elég ahhoz, hogy a feladó lássa: "nálunk olcsóbb".
//  A GLS/MPL árak 2024-es hivatalos árlistájukból.
// =====================================================================

// GLS normál csomag árak (2024, bruttó, belföldi)
function glsPrice(weightKg: number): number {
  if (weightKg <= 2)  return 2190;
  if (weightKg <= 5)  return 2490;
  if (weightKg <= 10) return 2890;
  if (weightKg <= 20) return 3490;
  if (weightKg <= 31.5) return 4690;
  return 6990; // XL
}

// MPL normál csomag árak (2024, bruttó, belföldi)
function mplPrice(weightKg: number): number {
  if (weightKg <= 2)  return 1990;
  if (weightKg <= 5)  return 2490;
  if (weightKg <= 10) return 2990;
  if (weightKg <= 20) return 3790;
  if (weightKg <= 30) return 4590;
  return 5990; // nagy csomag
}

// Foxpost csomagautomata (2024 árak)
function foxpostPrice(weightKg: number): number {
  if (weightKg <= 5)  return 990;
  if (weightKg <= 10) return 1290;
  if (weightKg <= 25) return 1690;
  return 0; // nem visz 25 kg felett
}

type Props = {
  goFuvarEstimate: number;
  weightKg: number;
};

export default function PriceComparison({ goFuvarEstimate, weightKg }: Props) {
  const gls = glsPrice(weightKg);
  const mpl = mplPrice(weightKg);
  const foxpost = foxpostPrice(weightKg);

  const competitors = [
    { name: 'GoFuvar', price: goFuvarEstimate, color: '#2E7D32', bold: true, note: 'Aznapi, rugalmas' },
    { name: 'GLS', price: gls, color: '#1565C0', bold: false, note: '1-2 munkanap' },
    { name: 'MPL (Posta)', price: mpl, color: '#C62828', bold: false, note: '2-3 munkanap' },
    ...(foxpost > 0 ? [{ name: 'Foxpost', price: foxpost, color: '#FF6F00', bold: false, note: 'Automata, max 25 kg' }] : []),
  ].sort((a, b) => a.price - b.price);

  const maxPrice = Math.max(...competitors.map((c) => c.price));
  const cheapest = competitors[0];

  return (
    <div style={{ marginTop: 16 }}>
      <h3 style={{ marginBottom: 12, fontSize: 15 }}>
        💸 Mennyit spórolsz?
      </h3>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        {competitors.map((c) => {
          const barWidth = Math.max(20, (c.price / maxPrice) * 100);
          const isCheapest = c === cheapest;
          return (
            <div key={c.name} style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              <div style={{ width: 80, fontSize: 13, fontWeight: c.bold ? 800 : 500, flexShrink: 0 }}>
                {c.name}
              </div>
              <div style={{ flex: 1, position: 'relative' }}>
                <div
                  style={{
                    width: `${barWidth}%`,
                    height: 28,
                    borderRadius: 6,
                    background: c.bold
                      ? 'linear-gradient(90deg, #2E7D32, #4CAF50)'
                      : `${c.color}33`,
                    border: c.bold ? '2px solid #2E7D32' : `1px solid ${c.color}44`,
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    padding: '0 8px',
                    transition: 'width 0.8s ease',
                  }}
                >
                  <span style={{
                    fontSize: 13, fontWeight: 700,
                    color: c.bold ? '#fff' : 'var(--text)',
                  }}>
                    {c.price.toLocaleString('hu-HU')} Ft
                  </span>
                  {isCheapest && (
                    <span style={{ fontSize: 10, fontWeight: 800, color: c.bold ? '#FFD700' : '#2E7D32' }}>
                      LEGJOBB
                    </span>
                  )}
                </div>
              </div>
              <div className="muted" style={{ width: 100, fontSize: 11, flexShrink: 0 }}>
                {c.note}
              </div>
            </div>
          );
        })}
      </div>
      <p className="muted" style={{ fontSize: 11, marginTop: 8 }}>
        * Becsült árak a nyilvános árlisták alapján. A tényleges ár eltérhet.
      </p>
    </div>
  );
}
