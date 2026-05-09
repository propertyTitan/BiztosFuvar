'use client';

// =====================================================================
//  "Hamarosan elérhető!" modal — megjelenik ha a felhasználó Pest
//  megyén kívüli címet ad meg. Elegáns, nem bosszantó, és lehetőséget
//  ad email feliratkozásra a bővítési értesítéshez.
// =====================================================================

import { useEffect, useState } from 'react';

export default function CoverageModal() {
  const [open, setOpen] = useState(false);
  const [email, setEmail] = useState('');
  const [subscribed, setSubscribed] = useState(false);

  useEffect(() => {
    function onOutsideCoverage() {
      setOpen(true);
      setSubscribed(false);
      setEmail('');
    }
    window.addEventListener('gofuvar:outside-coverage', onOutsideCoverage);
    return () => window.removeEventListener('gofuvar:outside-coverage', onOutsideCoverage);
  }, []);

  if (!open) return null;

  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 99990,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        background: 'rgba(0,0,0,0.6)',
        backdropFilter: 'blur(6px)',
      }}
      onClick={(e) => { if (e.target === e.currentTarget) setOpen(false); }}
    >
      <div
        style={{
          background: '#fff',
          borderRadius: 16,
          padding: 32,
          maxWidth: 440,
          width: '90%',
          position: 'relative',
          boxShadow: '0 20px 60px rgba(0,0,0,0.3)',
          color: '#1a1a1a',
          textAlign: 'center',
        }}
      >
        <button
          type="button"
          onClick={() => setOpen(false)}
          style={{
            position: 'absolute', top: 12, right: 12, background: 'none',
            border: 'none', fontSize: 22, cursor: 'pointer', color: '#666',
          }}
        >
          ×
        </button>

        <div style={{ fontSize: 56, marginBottom: 12 }}>📍</div>
        <h2 style={{ marginTop: 0, marginBottom: 8, fontSize: 22 }}>
          Hamarosan nálatok is!
        </h2>
        <p style={{ fontSize: 15, color: '#555', lineHeight: 1.6, marginBottom: 8 }}>
          A GoFuvar jelenleg <strong>Magyarország</strong> területén
          érhető el. A felvételi vagy lerakási címnek magyarországi címnek kell lennie.
        </p>

        <div
          style={{
            display: 'flex', gap: 8, flexWrap: 'wrap',
            justifyContent: 'center', margin: '16px 0',
          }}
        >
          {['Szeged', 'Debrecen', 'Győr', 'Pécs', 'Miskolc'].map((city) => (
            <span
              key={city}
              style={{
                padding: '4px 12px', borderRadius: 20,
                background: '#f3f4f6', fontSize: 13, color: '#666',
              }}
            >
              {city} — hamarosan
            </span>
          ))}
        </div>

        {subscribed ? (
          <div
            style={{
              marginTop: 16, padding: 14, borderRadius: 10,
              background: '#dcfce7', color: '#166534', fontWeight: 700,
            }}
          >
            ✅ Feliratkozva! Értesítünk ha elérhető a te városodban.
          </div>
        ) : (
          <div style={{ marginTop: 16 }}>
            <p style={{ fontSize: 13, color: '#888', marginBottom: 8 }}>
              Add meg az email címedet és szólunk, ha elérhető lesz:
            </p>
            <div style={{ display: 'flex', gap: 8 }}>
              <input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="email@example.hu"
                style={{
                  flex: 1, padding: '10px 14px', borderRadius: 8,
                  border: '1px solid #d1d5db', fontSize: 14,
                }}
              />
              <button
                type="button"
                onClick={() => {
                  if (email.includes('@')) {
                    console.log(`[coverage-waitlist] ${email}`);
                    setSubscribed(true);
                  }
                }}
                style={{
                  padding: '10px 20px', borderRadius: 8, border: 'none',
                  background: '#2E7D32', color: '#fff', fontWeight: 700,
                  fontSize: 14, cursor: 'pointer', whiteSpace: 'nowrap',
                }}
              >
                Értesíts!
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
