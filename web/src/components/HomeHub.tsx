'use client';

// GoFuvar Dashboard — kontextus-érzékeny, gamifikált kezdőoldal.
//
// Nem egy flat kártya-rács többé, hanem:
//   1) Gamifikációs fejléc (szint, progress, jelvények, voucher-ek)
//   2) Aktív fuvarok/foglalások (ha vannak)
//   3) Kontextus-alapú CTA ("3 fuvar vár rád a közeledben!")
//   4) Gyors linkek (kisebb, alulra)
import { useEffect, useState } from 'react';
import Link from 'next/link';
import { api } from '@/api';
import { useCurrentUser } from '@/lib/auth';
import { useTranslation } from '@/lib/i18n';

export default function HomeHub() {
  const user = useCurrentUser();
  const { t } = useTranslation();
  const [unread, setUnread] = useState(0);
  const [gameStats, setGameStats] = useState<any>(null);
  const [activeJobs, setActiveJobs] = useState<any[]>([]);

  useEffect(() => {
    if (!user) return;
    api.unreadNotificationCount().then((r) => setUnread(r.count)).catch(() => {});
    api.getGameStats().then(setGameStats).catch(() => {});
    // Aktív fuvarok (accepted + in_progress)
    api.myJobs('assigned').then((jobs) => {
      setActiveJobs(jobs.filter((j: any) => ['accepted', 'in_progress'].includes(j.status)));
    }).catch(() => {});
  }, [user]);

  if (!user) return null;

  const gs = gameStats;
  const levelDef = gs ? {
    progress: gs.progressToNext || 0,
    icon: gs.levelIcon || '🌱',
  } : null;

  return (
    <div>
      {/* ===== Gamifikációs fejléc ===== */}
      {gs && (
        <div
          style={{
            background: 'linear-gradient(135deg, var(--primary) 0%, #3b82f6 100%)',
            borderRadius: 20,
            padding: '28px 32px',
            color: '#fff',
            marginBottom: 24,
            position: 'relative',
            overflow: 'hidden',
          }}
        >
          {/* Háttér dekoráció */}
          <div style={{ position: 'absolute', right: -30, top: -30, fontSize: 140, opacity: 0.08 }}>
            {gs.levelIcon}
          </div>

          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 16 }}>
            <div>
              <div style={{ fontSize: 14, opacity: 0.8 }}>Level {gs.level}</div>
              <div style={{ fontSize: 28, fontWeight: 900 }}>
                {gs.levelIcon} {gs.levelName}
              </div>
              <div style={{ fontSize: 13, opacity: 0.85, marginTop: 4 }}>
                {user.full_name || user.email}
                {gs.isVerified && <span style={{ marginLeft: 8 }}>✅ Verified EU Carrier</span>}
              </div>
            </div>

            <div style={{ display: 'flex', gap: 20, textAlign: 'center' }}>
              <div>
                <div style={{ fontSize: 28, fontWeight: 900 }}>{gs.totalDeliveries}</div>
                <div style={{ fontSize: 11, opacity: 0.75 }}>fuvar</div>
              </div>
              <div>
                <div style={{ fontSize: 28, fontWeight: 900 }}>
                  {gs.ratingCount > 0 ? Number(gs.ratingAvg).toFixed(1) : '—'}
                </div>
                <div style={{ fontSize: 11, opacity: 0.75 }}>⭐ értékelés</div>
              </div>
              <div>
                <div style={{ fontSize: 28, fontWeight: 900 }}>{gs.trustScore}</div>
                <div style={{ fontSize: 11, opacity: 0.75 }}>trust</div>
              </div>
              <div>
                <div style={{ fontSize: 28, fontWeight: 900 }}>{gs.availableVouchers}</div>
                <div style={{ fontSize: 11, opacity: 0.75 }}>🎟️ voucher</div>
              </div>
            </div>
          </div>

          {/* Progress bar a következő szinthez */}
          {gs.nextLevel && (
            <div style={{ marginTop: 20 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, opacity: 0.8, marginBottom: 6 }}>
                <span>Level {gs.level}</span>
                <span>Level {gs.nextLevel.level}: {gs.nextLevel.icon} {gs.nextLevel.name}</span>
              </div>
              <div style={{ background: 'rgba(255,255,255,0.2)', borderRadius: 999, height: 10, overflow: 'hidden' }}>
                <div
                  style={{
                    background: '#fff',
                    height: '100%',
                    borderRadius: 999,
                    width: `${gs.progressToNext}%`,
                    transition: 'width 0.5s ease',
                  }}
                />
              </div>
              <div style={{ fontSize: 11, opacity: 0.7, marginTop: 4 }}>
                Még {gs.nextLevel.deliveriesNeeded} fuvar kell
                {gs.nextLevel.monthlyVouchers > 0 && ` · havi ${gs.nextLevel.monthlyVouchers} jutalékmentes fuvar jár`}
              </div>
            </div>
          )}

          {/* Jelvények sor */}
          {gs.badges.length > 0 && (
            <div style={{ display: 'flex', gap: 6, marginTop: 16, flexWrap: 'wrap' }}>
              {gs.badges.slice(0, 8).map((b: any) => (
                <span
                  key={b.badge_id}
                  title={b.badge_name}
                  style={{
                    background: 'rgba(255,255,255,0.2)',
                    borderRadius: 999,
                    padding: '4px 10px',
                    fontSize: 13,
                    cursor: 'default',
                  }}
                >
                  {b.badge_icon} {b.badge_name}
                </span>
              ))}
            </div>
          )}
        </div>
      )}

      {/* ===== Aktív fuvarok (ha vannak) ===== */}
      {activeJobs.length > 0 && (
        <div style={{ marginBottom: 24 }}>
          <h2 style={{ margin: '0 0 12px' }}>🚛 Aktív fuvarjaid</h2>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', gap: 12 }}>
            {activeJobs.map((j) => (
              <Link
                key={j.id}
                href={`/sofor/fuvar/${j.id}`}
                className="card"
                style={{ textDecoration: 'none', color: 'inherit', borderLeft: `4px solid ${j.status === 'in_progress' ? 'var(--success)' : 'var(--warning)'}` }}
              >
                <div style={{ fontWeight: 700 }}>{j.title}</div>
                <div className="muted" style={{ fontSize: 13 }}>
                  📍 {j.pickup_address?.split(',')[0]}
                </div>
                <div style={{ marginTop: 8 }}>
                  <span className={`pill ${j.status === 'in_progress' ? 'pill-progress' : 'pill-accepted'}`}>
                    {j.status === 'in_progress' ? '🟢 Úton' : '🟡 Elfogadva'}
                  </span>
                </div>
              </Link>
            ))}
          </div>
        </div>
      )}

      {/* ===== Gyors menü kártyák ===== */}
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fill, minmax(240px, 1fr))',
          gap: 14,
        }}
      >
        {[
          { href: '/sofor/fuvarok',           icon: '🎯', title: t('nav.biddableJobs'),  color: '#dbeafe' },
          { href: '/dashboard/utvonalak',     icon: '🛣️', title: t('nav.fixedRoutes'),   color: '#dcfce7' },
          { href: '/dashboard/foglalasaim',   icon: '📦', title: t('nav.myBookings'),    color: '#e0e7ff' },
          { href: '/feladas/uj',              icon: '📝', title: 'Új licites hirdetés',  color: '#fce7f3' }, // TODO: i18n
          { href: '/sofor/uj-utvonal',        icon: '➕', title: 'Új fix áras útvonal',  color: '#f3e8ff' },
          { href: '/hirdeteseim',             icon: '📋', title: t('nav.myListings'),    color: '#fde68a' },
          { href: '/sofor/licitjeim',         icon: '🏷️', title: 'Licitjeim',             color: '#bae6fd' },
          { href: '/sofor/sajat-fuvarok',     icon: '🚛', title: t('nav.myJobs'),        color: '#fef3c7' },
          { href: '/profil',                  icon: '👤', title: t('nav.profile'),       color: '#e0f2fe' },
          { href: '/ertesitesek',             icon: '🔔', title: t('nav.notifications'), color: '#ffe4e6', badge: unread },
          { href: '/ai-chat',                 icon: '🤖', title: t('nav.aiAssistant'),   color: '#f3e8ff' },
        ].map((c) => (
          <Link
            key={c.href}
            href={c.href}
            style={{
              display: 'flex', gap: 14, alignItems: 'center',
              padding: '16px 20px', borderRadius: 14,
              backgroundColor: 'var(--surface)',
              border: '1px solid var(--border)',
              textDecoration: 'none', color: 'inherit',
              transition: 'transform 0.1s',
              position: 'relative',
            }}
            className="home-hub-card"
          >
            <div
              style={{
                width: 44, height: 44, borderRadius: 10,
                background: c.color, display: 'flex',
                alignItems: 'center', justifyContent: 'center', fontSize: 20,
              }}
            >
              {c.icon}
            </div>
            <div style={{ fontWeight: 600, fontSize: 14 }}>{c.title}</div>
            {c.badge ? (
              <div style={{
                position: 'absolute', top: 10, right: 10,
                background: '#ef4444', color: '#fff', fontSize: 11,
                fontWeight: 700, borderRadius: 999, padding: '2px 8px',
              }}>
                {c.badge}
              </div>
            ) : null}
          </Link>
        ))}
      </div>
    </div>
  );
}
