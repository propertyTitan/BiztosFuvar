'use client';

// Admin panel — áttekintő dashboard az üzemeltetéshez.
//
// Szekciók:
//   1. Statisztikák (fuvarok, userek, bevétel)
//   2. Nyitott viták (dispute-ok)
//   3. User lista (keresés, ban)
//   4. Legutóbbi fuvarok
//
// Csak admin role-ú userek láthatják.
import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { api } from '@/api';
import { useCurrentUser } from '@/lib/auth';
import { useToast } from '@/components/ToastProvider';

export default function AdminPanel() {
  const me = useCurrentUser();
  const router = useRouter();
  const toast = useToast();

  const [stats, setStats] = useState<any>(null);
  const [disputes, setDisputes] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (me && me.role !== 'admin') {
      router.push('/');
      return;
    }
    if (!me) return;
    loadData();
  }, [me]);

  async function loadData() {
    setLoading(true);
    try {
      const [s, d] = await Promise.all([
        api.adminStats(),
        api.myDisputes(),
      ]);
      setStats(s);
      setDisputes(d);
    } catch (e: any) {
      toast.error('Hiba', e.message);
    } finally {
      setLoading(false);
    }
  }

  async function resolveDispute(id: string, status: string, note: string) {
    try {
      await api.resolveDispute(id, { status, resolution_note: note });
      toast.success('Vita lezárva');
      loadData();
    } catch (e: any) {
      toast.error('Hiba', e.message);
    }
  }

  if (!me || me.role !== 'admin') return null;
  if (loading) return <p>Betöltés…</p>;

  return (
    <div>
      <h1>🛡️ Admin Panel</h1>
      <p className="muted" style={{ marginTop: 0 }}>
        Üzemeltetési áttekintő — fuvarok, viták, felhasználók.
      </p>

      {/* Statisztikák */}
      {stats && (
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))',
            gap: 16,
            marginTop: 24,
          }}
        >
          {[
            { label: 'Összes fuvar', value: stats.total_jobs, color: '#dbeafe' },
            { label: 'Aktív fuvar', value: stats.active_jobs, color: '#dcfce7' },
            { label: 'Felhasználók', value: stats.total_users, color: '#fef3c7' },
            { label: 'Fix áras útvonalak', value: stats.total_routes, color: '#e0e7ff' },
            { label: 'Foglalások', value: stats.total_bookings, color: '#fce7f3' },
            { label: 'Nyitott viták', value: stats.open_disputes, color: '#fee2e2' },
          ].map((s) => (
            <div
              key={s.label}
              style={{
                background: s.color,
                padding: 20,
                borderRadius: 16,
                textAlign: 'center',
              }}
            >
              <div style={{ fontSize: 32, fontWeight: 900 }}>{s.value ?? '—'}</div>
              <div className="muted" style={{ fontSize: 13, marginTop: 4 }}>{s.label}</div>
            </div>
          ))}
        </div>
      )}

      {/* Nyitott viták */}
      <h2 style={{ marginTop: 32 }}>⚖️ Nyitott viták ({disputes.filter((d) => d.status === 'open' || d.status === 'under_review').length})</h2>
      {disputes.filter((d) => d.status === 'open' || d.status === 'under_review').length === 0 && (
        <div className="card">
          <p className="muted">Nincs nyitott vita. 🎉</p>
        </div>
      )}
      {disputes
        .filter((d) => d.status === 'open' || d.status === 'under_review')
        .map((d) => (
          <div key={d.id} className="card" style={{ marginTop: 12 }}>
            <div className="row" style={{ justifyContent: 'space-between', alignItems: 'start' }}>
              <div style={{ flex: 1 }}>
                <h3 style={{ marginTop: 0 }}>{d.job_title || d.route_title || 'Vita'}</h3>
                <p className="muted" style={{ margin: '4px 0' }}>
                  Nyitotta: <strong>{d.opened_by_name || 'Ismeretlen'}</strong> ↔ {d.against_name || '?'}
                </p>
                <p style={{ margin: '8px 0' }}>{d.description}</p>
                <span
                  className="pill"
                  style={{
                    background: d.status === 'open' ? '#fee2e2' : '#fef3c7',
                    fontWeight: 700,
                  }}
                >
                  {d.status === 'open' ? 'Nyitott' : 'Felülvizsgálat alatt'}
                </span>
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                <button
                  className="btn"
                  style={{ fontSize: 12, padding: '6px 12px', background: '#16a34a' }}
                  onClick={() => {
                    const note = window.prompt('Admin döntés indoklása:');
                    if (note) resolveDispute(d.id, 'resolved_no_action', note);
                  }}
                >
                  ✅ Nincs teendő
                </button>
                <button
                  className="btn"
                  style={{ fontSize: 12, padding: '6px 12px', background: '#f59e0b' }}
                  onClick={() => {
                    const note = window.prompt('Indoklás + visszatérítendő összeg?');
                    if (note) resolveDispute(d.id, 'resolved_refund', note);
                  }}
                >
                  💸 Refund
                </button>
                <button
                  className="btn btn-secondary"
                  style={{ fontSize: 12, padding: '6px 12px' }}
                  onClick={() => resolveDispute(d.id, 'under_review', 'Admin felülvizsgálat folyamatban')}
                >
                  🔍 Vizsgálat
                </button>
              </div>
            </div>
          </div>
        ))}

      {/* Lezárt viták */}
      <h2 style={{ marginTop: 32 }}>Lezárt viták</h2>
      {disputes
        .filter((d) => d.status !== 'open' && d.status !== 'under_review')
        .slice(0, 20)
        .map((d) => (
          <div key={d.id} className="card" style={{ marginTop: 8, opacity: 0.7 }}>
            <div className="row" style={{ gap: 12 }}>
              <span className="pill" style={{ background: '#dcfce7', fontWeight: 700 }}>
                {d.status === 'resolved_refund' ? '💸 Refund' :
                 d.status === 'resolved_no_action' ? '✅ Nincs teendő' :
                 d.status === 'closed' ? 'Lezárva' : d.status}
              </span>
              <span>{d.job_title || d.route_title || 'Vita'}</span>
              <span className="muted">{d.resolution_note || ''}</span>
            </div>
          </div>
        ))}
    </div>
  );
}
