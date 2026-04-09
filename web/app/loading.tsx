// Globális loading-állapot, amit a Next.js App Router automatikusan megjelenít
// minden útvonalváltás alatt, AMÍG az új page.tsx fetch-jei / kliens hydrálása
// be nem fejeződik.
//
// Miért kell?
// - Korábban `<a href>`-ek és akár `<Link>`-ek kattintása után a felhasználó
//   pár másodpercig MÉG A RÉGI oldalt látta (nincs `loading.tsx` → Next.js
//   nem tudja mit mutasson az átmenetben, úgyhogy a régi oldal marad). Ez a
//   "kattintottam de nem történt semmi, majd csak másodikra jó" érzés.
// - Ez a `loading.tsx` biztosítja, hogy MINDEN útvonalváltás AZONNAL vizuális
//   visszajelzést adjon, így nincs többé "elnyelt" kattintás.
export default function RootLoading() {
  return (
    <div
      style={{
        display: 'flex',
        justifyContent: 'center',
        alignItems: 'center',
        minHeight: '50vh',
        padding: 24,
      }}
    >
      <div style={{ textAlign: 'center' }}>
        <div
          aria-hidden
          style={{
            width: 44,
            height: 44,
            border: '4px solid rgba(30, 64, 175, 0.15)',
            borderTopColor: 'var(--primary, #1e40af)',
            borderRadius: '50%',
            margin: '0 auto 16px',
            animation: 'gofuvar-spin 0.8s linear infinite',
          }}
        />
        <p className="muted" style={{ margin: 0, fontSize: 14 }}>
          Betöltés…
        </p>
      </div>
      <style>{`
        @keyframes gofuvar-spin {
          from { transform: rotate(0deg); }
          to   { transform: rotate(360deg); }
        }
      `}</style>
    </div>
  );
}
