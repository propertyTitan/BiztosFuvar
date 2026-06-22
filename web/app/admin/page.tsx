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
import ConfirmDialog from '@/components/ConfirmDialog';
import { Loading } from '@/components/StateView';

export default function AdminPanel() {
  const me = useCurrentUser();
  const router = useRouter();
  const toast = useToast();

  const [stats, setStats] = useState<any>(null);
  const [disputes, setDisputes] = useState<any[]>([]);
  const [paymentLog, setPaymentLog] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  // Vita-döntés dialógus: { id, mode: 'no_action' | 'refund' }
  const [decision, setDecision] = useState<{ id: string; mode: 'no_action' | 'refund' } | null>(null);
  // Élő jelenlét — kik vannak éppen az oldalon (5 mp-enként frissül)
  const [live, setLive] = useState<Awaited<ReturnType<typeof api.adminLive>> | null>(null);
  // Felhasználók aktivitás-listája (utolsó belépés, aktív idő)
  const [users, setUsers] = useState<Awaited<ReturnType<typeof api.adminUsers>>>([]);
  const [userSearch, setUserSearch] = useState('');

  useEffect(() => {
    if (me && me.role !== 'admin') {
      router.push('/');
      return;
    }
    if (!me) return;
    loadData();
  }, [me]);

  // Élő jelenlét pollozása amíg admin néz minket
  useEffect(() => {
    if (!me || me.role !== 'admin') return;
    let alive = true;
    const tick = async () => {
      try {
        const p = await api.adminLive();
        if (alive) setLive(p);
      } catch { /* átmeneti hiba → következő tick újrapróbálja */ }
    };
    tick();
    const iv = setInterval(tick, 5000);
    return () => { alive = false; clearInterval(iv); };
  }, [me]);

  async function loadData() {
    setLoading(true);
    try {
      const [s, d, pl, u] = await Promise.all([
        api.adminStats(),
        api.allDisputes(),
        api.adminPaymentLog(30),
        api.adminUsers(),
      ]);
      setStats(s);
      setDisputes(d);
      setPaymentLog(pl);
      setUsers(u);
    } catch (e: any) {
      toast.error('Hiba', e.message);
    } finally {
      setLoading(false);
    }
  }

  async function resolveDispute(id: string, status: string, note: string, refundHuf?: number) {
    try {
      await api.resolveDispute(id, { status, resolution_note: note, refund_huf: refundHuf });
      toast.success('Vita lezárva');
      loadData();
    } catch (e: any) {
      toast.error('Hiba', e.message);
    }
  }

  async function searchUsers(q: string) {
    try {
      setUsers(await api.adminUsers(q.trim() || undefined));
    } catch (e: any) {
      toast.error('Hiba', e.message);
    }
  }

  // Aktív idő formázása: másodperc → emberi olvasható (perc / óra)
  function fmtActive(sec: number): string {
    if (!sec || sec <= 0) return '—';
    const min = Math.round(sec / 60);
    if (min < 60) return `${min} perc`;
    const h = Math.floor(min / 60);
    const m = min % 60;
    return m ? `${h} ó ${m} p` : `${h} óra`;
  }
  // Időpont formázása: relatív + abszolút tooltipre
  function fmtWhen(iso: string | null): string {
    if (!iso) return 'soha';
    const d = new Date(iso);
    const diffMs = Date.now() - d.getTime();
    const min = Math.floor(diffMs / 60000);
    if (min < 1) return 'most';
    if (min < 60) return `${min} perce`;
    const h = Math.floor(min / 60);
    if (h < 24) return `${h} órája`;
    const days = Math.floor(h / 24);
    if (days < 30) return `${days} napja`;
    return d.toLocaleDateString('hu-HU');
  }
  // Ki van ÉPPEN online (az élő jelenlét-listából)
  const onlineIds = new Set((live?.users || []).map((u) => u.id));

  // Első rendernél a `me` még null (localStorage-ből töltődik) — ilyenkor
  // betöltőt mutatunk, nem üres képernyőt. Nem-admin usert az effect átirányít.
  if (!me) return <Loading />;
  if (me.role !== 'admin') return null;
  if (loading) return <Loading />;

  return (
    <div>
      <h1>🛡️ Admin Panel</h1>
      <p className="muted" style={{ marginTop: 0 }}>
        Üzemeltetési áttekintő — fuvarok, viták, felhasználók.
      </p>

      {/* Élő jelenlét — kik vannak ÉPPEN az oldalon */}
      <div
        className="card"
        style={{
          marginTop: 20,
          display: 'flex',
          alignItems: 'center',
          gap: 24,
          flexWrap: 'wrap',
          borderColor: '#22c55e',
          background: 'linear-gradient(135deg, rgba(34,197,94,0.08), transparent)',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
          <span
            aria-hidden
            style={{
              width: 12, height: 12, borderRadius: '50%', background: '#22c55e',
              boxShadow: '0 0 0 0 rgba(34,197,94,0.6)', animation: 'gf-pulse 1.6s infinite',
              display: 'inline-block', flexShrink: 0,
            }}
          />
          <div>
            <div style={{ fontSize: 44, fontWeight: 900, lineHeight: 1 }}>
              {live ? live.online_users : '—'}
            </div>
            <div className="muted" style={{ fontSize: 13, marginTop: 4 }}>
              bejelentkezett felhasználó van most az oldalon
            </div>
          </div>
        </div>
        <div className="row" style={{ gap: 20, flexWrap: 'wrap', fontSize: 14 }}>
          <span title="Feladók">📦 {live?.by_role?.shipper ?? 0} feladó</span>
          <span title="Sofőrök">🚚 {live?.by_role?.carrier ?? 0} sofőr</span>
          <span title="Adminok">🛡️ {live?.by_role?.admin ?? 0} admin</span>
          <span className="muted" title="Token nélküli (vendég) kapcsolatok">
            👤 {live?.anonymous ?? 0} vendég
          </span>
          <span className="muted" title="Összes élő kapcsolat (egy user több füllel is lehet)">
            🔌 {live?.total_connections ?? 0} kapcsolat
          </span>
        </div>
        <style>{`@keyframes gf-pulse {
          0% { box-shadow: 0 0 0 0 rgba(34,197,94,0.6); }
          70% { box-shadow: 0 0 0 10px rgba(34,197,94,0); }
          100% { box-shadow: 0 0 0 0 rgba(34,197,94,0); }
        }`}</style>
      </div>

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

      {/* Felhasználók — utolsó belépés és aktivitás */}
      <h2 style={{ marginTop: 32 }}>👥 Felhasználók aktivitása ({users.length})</h2>
      <div className="card">
        <div className="row" style={{ gap: 8, marginBottom: 12, flexWrap: 'wrap' }}>
          <input
            className="input"
            style={{ flex: 1, minWidth: 200 }}
            placeholder="Keresés név / email / telefon…"
            value={userSearch}
            onChange={(e) => setUserSearch(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') searchUsers(userSearch); }}
          />
          <button className="btn btn-ghost" onClick={() => searchUsers(userSearch)}>Keresés</button>
          {userSearch && (
            <button className="btn btn-ghost" onClick={() => { setUserSearch(''); searchUsers(''); }}>Törlés</button>
          )}
        </div>
        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13, minWidth: 640 }}>
            <thead>
              <tr style={{ textAlign: 'left', color: 'var(--muted)', borderBottom: '1px solid var(--border)' }}>
                <th style={{ padding: '8px 10px' }}>Felhasználó</th>
                <th style={{ padding: '8px 10px' }}>Szerep</th>
                <th style={{ padding: '8px 10px' }}>Utolsó belépés</th>
                <th style={{ padding: '8px 10px', textAlign: 'center' }}>Belépések</th>
                <th style={{ padding: '8px 10px' }}>Utoljára aktív</th>
                <th style={{ padding: '8px 10px', textAlign: 'right' }}>Összes aktív idő</th>
              </tr>
            </thead>
            <tbody>
              {users.map((u) => {
                const online = onlineIds.has(u.id);
                return (
                  <tr key={u.id} style={{ borderBottom: '1px solid var(--border)' }}>
                    <td style={{ padding: '8px 10px' }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                        <span
                          title={online ? 'Éppen online' : 'Offline'}
                          style={{
                            width: 8, height: 8, borderRadius: '50%', flexShrink: 0,
                            background: online ? '#22c55e' : 'var(--border)',
                          }}
                        />
                        <div>
                          <div style={{ fontWeight: 600 }}>{u.full_name || '—'}</div>
                          <div className="muted" style={{ fontSize: 11 }}>{u.email}</div>
                        </div>
                      </div>
                    </td>
                    <td style={{ padding: '8px 10px' }}>{u.role}</td>
                    <td style={{ padding: '8px 10px' }} title={u.last_login_at ? new Date(u.last_login_at).toLocaleString('hu-HU') : 'soha'}>
                      {fmtWhen(u.last_login_at)}
                    </td>
                    <td style={{ padding: '8px 10px', textAlign: 'center' }}>{u.login_count ?? 0}</td>
                    <td style={{ padding: '8px 10px' }} title={u.last_seen_at ? new Date(u.last_seen_at).toLocaleString('hu-HU') : 'soha'}>
                      {fmtWhen(u.last_seen_at)}
                    </td>
                    <td style={{ padding: '8px 10px', textAlign: 'right', fontWeight: 600 }}>
                      {fmtActive(u.total_active_seconds)}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        <p className="muted" style={{ fontSize: 11, marginTop: 10, marginBottom: 0 }}>
          Az „összes aktív idő" becsült érték: az oldalon nyitott munkamenetek hosszából gyűjtjük.
          A zöld pont azt jelzi, ki van éppen online.
        </p>
      </div>

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
                  style={{ fontSize: 12, padding: '6px 12px', background: 'var(--success)' }}
                  onClick={() => setDecision({ id: d.id, mode: 'no_action' })}
                >
                  ✅ Nincs teendő
                </button>
                <button
                  className="btn"
                  style={{ fontSize: 12, padding: '6px 12px', background: 'var(--warning)' }}
                  onClick={() => setDecision({ id: d.id, mode: 'refund' })}
                >
                  💸 Visszatérítés
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
      {/* 💰 Fizetési napló */}
      <h2 style={{ marginTop: 32 }}>💰 Fizetési napló (utolsó {paymentLog.length})</h2>
      {paymentLog.length === 0 && (
        <div className="card"><p className="muted">Még nincs fizetési esemény.</p></div>
      )}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        {paymentLog.map((pe) => (
          <div
            key={pe.id}
            className="card"
            style={{
              padding: 12,
              borderLeft: `4px solid ${
                pe.status === 'Succeeded' ? 'var(--success)' :
                pe.status === 'Canceled' || pe.status === 'Expired' ? 'var(--danger)' :
                'var(--border)'
              }`,
            }}
          >
            <div className="row" style={{ justifyContent: 'space-between', alignItems: 'center' }}>
              <div style={{ flex: 1 }}>
                <div style={{ fontWeight: 700, fontSize: 14 }}>
                  {pe.status === 'Succeeded' ? '✅' : pe.status === 'Canceled' ? '❌' : '⏳'}{' '}
                  {pe.job_title || pe.route_title || pe.payment_id?.slice(0, 12)}
                </div>
                <div className="muted" style={{ fontSize: 12, marginTop: 2 }}>
                  {pe.summary || `${pe.status} — ${pe.total_amount || '?'} ${pe.currency || 'HUF'}`}
                </div>
              </div>
              <div style={{ textAlign: 'right', flexShrink: 0 }}>
                {pe.platform_fee != null && (
                  <div style={{ fontWeight: 700, color: 'var(--success)', fontSize: 14 }}>
                    +{pe.platform_fee} {pe.currency}
                  </div>
                )}
                <div className="muted" style={{ fontSize: 11 }}>
                  {new Date(pe.created_at).toLocaleString('hu-HU')}
                </div>
              </div>
            </div>
            {pe.is_reverse_charge && (
              <span className="pill" style={{ marginTop: 4, background: 'var(--surface)', fontSize: 10 }}>
                Fordított adózás
              </span>
            )}
          </div>
        ))}
      </div>

      {/* Vita-döntés dialógus (a korábbi window.prompt kiváltása) */}
      <ConfirmDialog
        open={!!decision}
        title={decision?.mode === 'refund' ? '💸 Visszatérítés a feladónak' : '✅ Vita lezárása — nincs teendő'}
        message={decision?.mode === 'refund'
          ? 'A döntésről mindkét fél értesítést kap. A visszatérítendő összeget forintban add meg.'
          : 'A döntésről mindkét fél értesítést kap.'}
        confirmLabel="Döntés rögzítése"
        fields={decision?.mode === 'refund' ? [
          { key: 'note', label: 'Indoklás', type: 'textarea', required: true, placeholder: 'Miért jár a visszatérítés?' },
          { key: 'refund', label: 'Visszatérítendő összeg (Ft)', type: 'number', required: true, placeholder: 'pl. 5000' },
        ] : [
          { key: 'note', label: 'Indoklás', type: 'textarea', required: true, placeholder: 'Admin döntés indoklása' },
        ]}
        onConfirm={(v) => {
          if (!decision) return;
          if (decision.mode === 'refund') {
            const amount = Math.round(Number(v.refund));
            if (!Number.isFinite(amount) || amount <= 0) {
              toast.error('Hibás összeg', 'A visszatérítendő összeg pozitív szám legyen.');
              return;
            }
            resolveDispute(decision.id, 'resolved_refund', v.note.trim(), amount);
          } else {
            resolveDispute(decision.id, 'resolved_no_action', v.note.trim());
          }
          setDecision(null);
        }}
        onClose={() => setDecision(null)}
      />
    </div>
  );
}
