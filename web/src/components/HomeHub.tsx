'use client';

// GoFuvar Okos Dashboard — mód-váltó (Sofőr / Feladó) + állapot-alapú.
//
// Sofőr mód: aktív fuvarok → 1 nagy CTA, heti kereset, közeli munkák
// Feladó mód: saját hirdetések, foglalások, átvételi kódok
import { useEffect, useState } from 'react';
import Link from 'next/link';
import { api } from '@/api';
import { useCurrentUser } from '@/lib/auth';
import { useTranslation, formatPrice } from '@/lib/i18n';

type Mode = 'driver' | 'shipper';

export default function HomeHub() {
  const user = useCurrentUser();
  const { t } = useTranslation();
  const [mode, setMode] = useState<Mode>('shipper');
  const [unread, setUnread] = useState(0);
  const [driver, setDriver] = useState<any>(null);
  const [gameStats, setGameStats] = useState<any>(null);

  useEffect(() => {
    if (!user) return;
    api.unreadNotificationCount().then((r) => setUnread(r.count)).catch(() => {});
    api.getDriverDashboard().then(setDriver).catch(() => {});
    api.getGameStats().then(setGameStats).catch(() => {});
    // Tárolt mód visszaolvasása
    const saved = localStorage.getItem('gofuvar_mode');
    if (saved === 'shipper' || saved === 'driver') setMode(saved as Mode);
  }, [user]);

  function switchMode(m: Mode) {
    setMode(m);
    localStorage.setItem('gofuvar_mode', m);
  }

  if (!user) return null;

  const gs = gameStats;
  const d = driver;

  return (
    <div>
      {/* ===== Mód-váltó ===== */}
      <div style={{
        display: 'flex', justifyContent: 'center', marginBottom: 24, gap: 4,
        background: 'var(--surface)', borderRadius: 12, padding: 4,
        border: '1px solid var(--border)', maxWidth: 320, margin: '0 auto 24px',
      }}>
        <button
          type="button"
          onClick={() => switchMode('driver')}
          style={{
            flex: 1, padding: '10px 0', borderRadius: 10, border: 'none',
            fontWeight: 700, fontSize: 14, cursor: 'pointer', transition: 'all 0.15s',
            background: mode === 'driver' ? 'var(--primary)' : 'transparent',
            color: mode === 'driver' ? '#fff' : 'var(--muted)',
          }}
        >
          🚛 Sofőr
        </button>
        <button
          type="button"
          onClick={() => switchMode('shipper')}
          style={{
            flex: 1, padding: '10px 0', borderRadius: 10, border: 'none',
            fontWeight: 700, fontSize: 14, cursor: 'pointer', transition: 'all 0.15s',
            background: mode === 'shipper' ? 'var(--primary)' : 'transparent',
            color: mode === 'shipper' ? '#fff' : 'var(--muted)',
          }}
        >
          📦 Feladó
        </button>
      </div>

      {/* ===== SOFŐR MÓD ===== */}
      {mode === 'driver' && (
        <>
          {/* Fejléc: üdvözlés + heti kereset */}
          <div style={{
            display: 'flex', justifyContent: 'space-between', alignItems: 'center',
            marginBottom: 20, flexWrap: 'wrap', gap: 12,
          }}>
            <div>
              <h1 style={{ margin: 0 }}>Szia, {user.full_name?.split(' ')[0] || 'Sofőr'}! 👋</h1>
              <p className="muted" style={{ margin: '4px 0 0' }}>
                {d ? `Level ${d.level} ${d.levelName}` : ''}
                {d?.isVerified ? ' · ✅ Verified' : ''}
                {d?.ratingCount > 0 ? ` · ⭐ ${Number(d.ratingAvg).toFixed(1)}` : ''}
                {d?.availableVouchers > 0 ? ` · 🎟️ ${d.availableVouchers} voucher` : ''}
              </p>
            </div>
            {d && (
            <div style={{
              background: 'linear-gradient(135deg, var(--success) 0%, #22c55e 100%)',
              color: '#fff', padding: '12px 24px', borderRadius: 14, textAlign: 'center',
            }}>
              <div style={{ fontSize: 11, opacity: 0.85 }}>Heti kereset</div>
              <div style={{ fontSize: 26, fontWeight: 900 }}>
                {formatPrice(d.weekEarnings)}
              </div>
              <div style={{ fontSize: 11, opacity: 0.85 }}>{d.weekDeliveries} fuvar</div>
            </div>
            )}
          </div>

          {/* ÁLLAPOT-ALAPÚ FŐ KÁRTYA */}
          {d && d.activeJobs.length > 0 ? (
            // Van aktív fuvar → ez a fő tartalom
            <div style={{ marginBottom: 24 }}>
              <h2 style={{ margin: '0 0 12px' }}>🟢 Aktív fuvarjaid</h2>
              {d.activeJobs.map((j: any) => (
                <Link
                  key={j.id}
                  href={`/sofor/fuvar/${j.id}`}
                  className="card"
                  style={{
                    display: 'block', textDecoration: 'none', color: 'inherit',
                    borderLeft: `4px solid ${j.status === 'in_progress' ? 'var(--success)' : 'var(--warning)'}`,
                    marginBottom: 12,
                  }}
                >
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <div>
                      <div style={{ fontWeight: 700, fontSize: 16 }}>{j.title}</div>
                      <div className="muted" style={{ fontSize: 13 }}>
                        📍 {j.pickup_address?.split(',')[0]} → 🏁 {j.dropoff_address?.split(',')[0]}
                      </div>
                      <div className="muted" style={{ fontSize: 12, marginTop: 4 }}>
                        Feladó: {j.shipper_name} · {j.distance_km} km
                      </div>
                    </div>
                    <div style={{ textAlign: 'right' }}>
                      <span className={`pill ${j.status === 'in_progress' ? 'pill-progress' : 'pill-accepted'}`}
                        style={{ fontSize: 13, padding: '6px 14px' }}>
                        {j.status === 'in_progress' ? '🟢 Úton' : '🟡 Elfogadva'}
                      </span>
                      <div className="price" style={{ marginTop: 8, fontSize: 18 }}>
                        {formatPrice(j.accepted_price_huf)}
                      </div>
                      {j.status === 'accepted' && (
                        <div style={{
                          marginTop: 8, background: 'var(--success)', color: '#fff',
                          padding: '6px 14px', borderRadius: 8, fontWeight: 700, fontSize: 13,
                        }}>
                          📸 INDÍTÁS →
                        </div>
                      )}
                      {j.status === 'in_progress' && (
                        <div style={{
                          marginTop: 8, background: '#dc2626', color: '#fff',
                          padding: '6px 14px', borderRadius: 8, fontWeight: 700, fontSize: 13,
                        }}>
                          📸 LEZÁRÁS →
                        </div>
                      )}
                    </div>
                  </div>
                </Link>
              ))}
            </div>
          ) : (
            // Nincs aktív fuvar → közeli munkák CTA
            <div className="card" style={{
              textAlign: 'center', padding: 32, marginBottom: 24,
              border: '2px dashed var(--border)',
              background: 'var(--bg)',
            }}>
              <div style={{ fontSize: 48, marginBottom: 12 }}>🎯</div>
              <h2 style={{ margin: '0 0 8px' }}>
                {(d?.nearbyJobsCount || 0) > 0
                  ? `${d.nearbyJobsCount} fuvar vár a közeledben!`
                  : 'Keress licitálható fuvarokat!'}
              </h2>
              <p className="muted" style={{ marginBottom: 16 }}>
                {(d?.nearbyJobsCount || 0) > 0
                  ? 'Nézd meg a licitálható fuvarokat és tegyél ajánlatot.'
                  : 'Nézz körül a fuvarok között, vagy hirdess meg egy fix áras útvonalat.'}
              </p>
              <div style={{ display: 'flex', gap: 12, justifyContent: 'center', flexWrap: 'wrap' }}>
                <Link href="/sofor/fuvarok" className="btn" style={{ textDecoration: 'none' }}>
                  🎯 Fuvarok böngészése
                </Link>
                <Link href="/sofor/uj-utvonal" className="btn btn-secondary" style={{ textDecoration: 'none' }}>
                  ➕ Útvonal hirdetése
                </Link>
              </div>
            </div>
          )}

          {/* Várakozó licitek */}
          {d && d.pendingBidsCount > 0 && (
            <Link
              href="/sofor/licitjeim"
              className="card"
              style={{
                display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                textDecoration: 'none', color: 'inherit', marginBottom: 12,
                borderLeft: '4px solid var(--warning)',
              }}
            >
              <div>
                <div style={{ fontWeight: 700 }}>🏷️ {d.pendingBidsCount} licitedre válaszra vár</div>
                <div className="muted" style={{ fontSize: 13 }}>Koppints a részletekhez</div>
              </div>
              <span style={{ fontSize: 20 }}>→</span>
            </Link>
          )}

          {/* Gyors sofőr linkek */}
          <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', marginTop: 16 }}>
            {[
              { href: '/sofor/fuvarok', icon: '🎯', label: 'Fuvarok' },
              { href: '/sofor/dashboard', icon: '📊', label: 'Dashboard' },
              { href: '/sofor/licitjeim', icon: '🏷️', label: 'Licitjeim' },
              { href: '/sofor/sajat-fuvarok', icon: '🚛', label: t('nav.myJobs') },
              { href: '/sofor/visszafuvar', icon: '🔄', label: 'Visszafuvar' },
              { href: '/sofor/uj-utvonal', icon: '➕', label: 'Új útvonal' },
              { href: '/sofor/utvonalaim', icon: '🛣️', label: 'Útvonalaim' },
            ].map((l) => (
              <Link
                key={l.href}
                href={l.href}
                style={{
                  flex: '1 1 calc(33% - 10px)', minWidth: 100,
                  display: 'flex', gap: 8, alignItems: 'center',
                  padding: '12px 14px', borderRadius: 10,
                  background: 'var(--surface)', border: '1px solid var(--border)',
                  textDecoration: 'none', color: 'var(--text)',
                  fontSize: 13, fontWeight: 600, transition: 'all 0.15s',
                }}
                className="home-hub-card"
              >
                <span style={{ fontSize: 18 }}>{l.icon}</span> {l.label}
              </Link>
            ))}
          </div>
        </>
      )}

      {/* ===== FELADÓ MÓD ===== */}
      {mode === 'shipper' && (
        <>
          <div style={{ marginBottom: 20 }}>
            <h1 style={{ margin: 0 }}>Szia, {user.full_name?.split(' ')[0] || 'Feladó'}! 👋</h1>
            <p className="muted" style={{ margin: '4px 0 0' }}>
              Mit szeretnél szállíttatni ma?
            </p>
          </div>

          {/* Fő CTA: hirdetés feladás */}
          <div style={{
            display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14, marginBottom: 24,
          }}>
            <Link
              href="/dashboard/uj-fuvar"
              className="card home-hub-card"
              style={{
                textDecoration: 'none', color: 'inherit', textAlign: 'center',
                padding: 28, borderTop: '4px solid var(--primary)',
              }}
            >
              <div style={{ fontSize: 36, marginBottom: 8 }}>📝</div>
              <div style={{ fontWeight: 700, fontSize: 15 }}>Licites hirdetés</div>
              <div className="muted" style={{ fontSize: 12, marginTop: 4 }}>Sofőrök licitálnak rá</div>
            </Link>
            <Link
              href="/dashboard/utvonalak"
              className="card home-hub-card"
              style={{
                textDecoration: 'none', color: 'inherit', textAlign: 'center',
                padding: 28, borderTop: '4px solid var(--success)',
              }}
            >
              <div style={{ fontSize: 36, marginBottom: 8 }}>🛣️</div>
              <div style={{ fontWeight: 700, fontSize: 15 }}>Fix áras útvonal</div>
              <div className="muted" style={{ fontSize: 12, marginTop: 4 }}>Foglalj helyet egy sofőrnél</div>
            </Link>
          </div>

          {/* Feladó gyors linkek */}
          <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
            {[
              { href: '/hirdeteseim', icon: '📋', label: t('nav.myListings') },
              { href: '/dashboard/foglalasaim', icon: '📦', label: t('nav.myBookings') },
              { href: '/ertesitesek', icon: '🔔', label: t('nav.notifications'), badge: unread },
              { href: '/profil', icon: '👤', label: t('nav.profile') },
              { href: '/ai-chat', icon: '🤖', label: t('nav.aiAssistant') },
            ].map((l) => (
              <Link
                key={l.href}
                href={l.href}
                style={{
                  flex: '1 1 calc(33% - 10px)', minWidth: 100,
                  display: 'flex', gap: 8, alignItems: 'center',
                  padding: '12px 14px', borderRadius: 10, position: 'relative',
                  background: 'var(--surface)', border: '1px solid var(--border)',
                  textDecoration: 'none', color: 'var(--text)',
                  fontSize: 13, fontWeight: 600, transition: 'all 0.15s',
                }}
                className="home-hub-card"
              >
                <span style={{ fontSize: 18 }}>{l.icon}</span> {l.label}
                {l.badge ? (
                  <span style={{
                    position: 'absolute', top: 6, right: 8,
                    background: '#ef4444', color: '#fff', fontSize: 10,
                    fontWeight: 800, borderRadius: 999, padding: '1px 6px',
                  }}>{l.badge}</span>
                ) : null}
              </Link>
            ))}
          </div>
        </>
      )}
    </div>
  );
}
