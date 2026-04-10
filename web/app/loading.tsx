// Globális loading — guruló teherautó animáció.
//
// A GoFuvar "ujjlenyomata": egy kis 🚛 balról jobbra gurul egy halvány
// útvonal mentén, pont alatta. Egyedi, felismerhető, mosolyt csal.
// Minden route-váltáskor ezt látja a user a régi oldal helyett.
export default function RootLoading() {
  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        justifyContent: 'center',
        alignItems: 'center',
        minHeight: '50vh',
        padding: 24,
        gap: 8,
      }}
    >
      {/* Út + teherautó */}
      <div
        style={{
          position: 'relative',
          width: 280,
          height: 60,
          overflow: 'hidden',
        }}
      >
        {/* Az út vonal */}
        <div
          style={{
            position: 'absolute',
            bottom: 8,
            left: 0,
            right: 0,
            height: 3,
            background: 'linear-gradient(90deg, transparent 0%, var(--border, #e2e8f0) 15%, var(--border, #e2e8f0) 85%, transparent 100%)',
            borderRadius: 999,
          }}
        />
        {/* Szaggatott útjelzés */}
        <div
          style={{
            position: 'absolute',
            bottom: 9,
            left: 0,
            right: 0,
            height: 1,
            backgroundImage: 'repeating-linear-gradient(90deg, var(--muted, #94a3b8) 0px, var(--muted, #94a3b8) 8px, transparent 8px, transparent 16px)',
            opacity: 0.3,
            animation: 'gofuvar-road 1s linear infinite',
          }}
        />
        {/* A guruló teherautó */}
        <div
          aria-hidden
          style={{
            position: 'absolute',
            bottom: 12,
            left: 0,
            fontSize: 36,
            animation: 'gofuvar-truck 2.5s ease-in-out infinite',
            filter: 'drop-shadow(0 2px 4px rgba(0,0,0,0.15))',
          }}
        >
          🚛
        </div>
        {/* Kis porfelhő a teherautó mögött */}
        <div
          style={{
            position: 'absolute',
            bottom: 14,
            left: 0,
            fontSize: 14,
            opacity: 0.4,
            animation: 'gofuvar-dust 2.5s ease-in-out infinite',
          }}
        >
          💨
        </div>
      </div>

      <p
        style={{
          margin: 0,
          fontSize: 14,
          color: 'var(--muted, #64748b)',
          fontWeight: 500,
          letterSpacing: 0.3,
        }}
      >
        Betöltés…
      </p>

      <style>{`
        @keyframes gofuvar-truck {
          0%   { transform: translateX(-10px); }
          50%  { transform: translateX(230px); }
          51%  { transform: translateX(230px) scaleX(-1); }
          100% { transform: translateX(-10px) scaleX(-1); }
        }
        @keyframes gofuvar-dust {
          0%   { transform: translateX(-20px); opacity: 0; }
          10%  { opacity: 0.4; }
          45%  { transform: translateX(200px); opacity: 0; }
          55%  { transform: translateX(260px); opacity: 0; }
          60%  { opacity: 0.4; }
          95%  { transform: translateX(20px); opacity: 0; }
          100% { transform: translateX(-20px); opacity: 0; }
        }
        @keyframes gofuvar-road {
          from { background-position-x: 0; }
          to   { background-position-x: -16px; }
        }
      `}</style>
    </div>
  );
}
