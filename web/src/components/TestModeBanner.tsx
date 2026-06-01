// IDEIGLENES teszt-mód banner. Eltávolításhoz: töröld ezt a fájlt és a
// <TestModeBanner /> hivatkozásokat (LandingPage.tsx, app/bejelentkezes/page.tsx).
//
// A háttér szándékosan #fef3c7 (a globals.css ismert pasztell-listájában
// szerepel), az .on-light osztállyal együtt így a szöveg dark mode-ban is
// sötét és olvasható marad.
export default function TestModeBanner() {
  return (
    <div
      role="status"
      className="on-light"
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 10,
        margin: '16px 0',
        padding: '12px 16px',
        background: '#fef3c7',
        border: '1px solid #f0c200',
        borderRadius: 12,
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
