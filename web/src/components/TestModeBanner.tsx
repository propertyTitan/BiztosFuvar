// IDEIGLENES teszt-mód banner. Eltávolításhoz: töröld ezt a fájlt és a
// <TestModeBanner /> hivatkozásokat (LandingPage.tsx, app/bejelentkezes/page.tsx).
export default function TestModeBanner() {
  return (
    <div
      role="status"
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 10,
        margin: '16px 0',
        padding: '12px 16px',
        background: '#fff4d6',
        border: '1px solid #f0c200',
        borderRadius: 12,
        color: '#7a5a00',
        fontSize: 14,
        lineHeight: 1.4,
      }}
    >
      <span style={{ fontSize: 20, flexShrink: 0 }} aria-hidden="true">🚧</span>
      <span>
        <strong>Teszt üzemmód.</strong> Az oldal jelenleg tesztelés alatt áll —
        valódi pénzmozgás nincs, a fizetés csak szimuláció.
      </span>
    </div>
  );
}
