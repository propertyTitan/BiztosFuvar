'use client';

// Admin panel v2 — teljes értékű üzemeltetési felület, fülekre szedve.
//
// Fülek (hash-alapú, így az értesítések #kyc linkje továbbra is él):
//   #attekintes    — élő jelenlét, statisztikák, fizetési napló
//   #kyc           — KYC kézi jóváhagyás (kép-előnézettel)
//   #felhasznalok  — aktivitás + szerep/KYC szerkesztés, kiléptetés, törlés
//   #fuvarok       — keresés/szűrés, státusz-átállítás, ajánlatok, chat,
//                    fotó-zárolás (retenció), törlés
//   #jaratok       — járatok + foglalások (törlés, fotó-zárolás)
//   #vitak         — nyitott/lezárt viták, döntés, a felek chatje
//
// Csak admin role látja; a veszélyes műveletek ConfirmDialog mögött.
import { useEffect, useState, type ReactNode } from 'react';
import { useRouter } from 'next/navigation';
import { api, photoUrl } from '@/api';
import { useCurrentUser } from '@/lib/auth';
import { useToast } from '@/components/ToastProvider';
import ConfirmDialog from '@/components/ConfirmDialog';
import { Loading, ListSkeleton, EmptyState } from '@/components/StateView';
import {
  LayoutDashboard, IdCard, Users as UsersIcon, Package, Route as RouteIcon,
  Scale, Banknote, Lock, Unlock, LogOut, Trash2, MessageSquare, Search,
  ShieldCheck, CircleDot, RefreshCw,
} from 'lucide-react';

type TabId = 'attekintes' | 'kyc' | 'felhasznalok' | 'fuvarok' | 'jaratok' | 'vitak';

const TABS: Array<{ id: TabId; label: string; icon: typeof LayoutDashboard }> = [
  { id: 'attekintes', label: 'Áttekintés', icon: LayoutDashboard },
  { id: 'kyc', label: 'KYC', icon: IdCard },
  { id: 'felhasznalok', label: 'Felhasználók', icon: UsersIcon },
  { id: 'fuvarok', label: 'Fuvarok', icon: Package },
  { id: 'jaratok', label: 'Járatok & foglalások', icon: RouteIcon },
  { id: 'vitak', label: 'Viták', icon: Scale },
];

const JOB_STATUSES = ['pending', 'bidding', 'accepted', 'in_progress', 'delivered', 'completed', 'disputed', 'cancelled'];
const JOB_STATUS_LABEL: Record<string, string> = {
  pending: 'Várakozik', bidding: 'Ajánlatokat vár', accepted: 'Elfogadva',
  in_progress: 'Folyamatban', delivered: 'Lerakva', completed: 'Lezárva',
  disputed: 'Vitatott', cancelled: 'Lemondva',
};

const KYC_DOC_LABEL: Record<string, string> = {
  id_card: 'Személyi igazolvány',
  drivers_license: 'Jogosítvány',
  company_document: 'Céges dokumentum',
  insurance: 'Biztosítás',
  vehicle_registration: 'Forgalmi',
};

// ─── Segéd-formázók ───
function fmtActive(sec: number): string {
  if (!sec || sec <= 0) return '—';
  const min = Math.round(sec / 60);
  if (min < 60) return `${min} perc`;
  const h = Math.floor(min / 60);
  const m = min % 60;
  return m ? `${h} ó ${m} p` : `${h} óra`;
}
function fmtWhen(iso: string | null): string {
  if (!iso) return 'soha';
  const d = new Date(iso);
  const min = Math.floor((Date.now() - d.getTime()) / 60000);
  if (min < 1) return 'most';
  if (min < 60) return `${min} perce`;
  const h = Math.floor(min / 60);
  if (h < 24) return `${h} órája`;
  const days = Math.floor(h / 24);
  if (days < 30) return `${days} napja`;
  return d.toLocaleDateString('hu-HU');
}

function SectionTitle({ icon, children }: { icon: ReactNode; children: ReactNode }) {
  return (
    <h2 style={{ marginTop: 24, display: 'flex', alignItems: 'center', gap: 8 }}>
      {icon} {children}
    </h2>
  );
}

export default function AdminPanel() {
  const me = useCurrentUser();
  const router = useRouter();
  const toast = useToast();

  const [tab, setTab] = useState<TabId>('attekintes');
  const [loading, setLoading] = useState(true);

  // Közös adatok (az Áttekintés + KYC + Felhasználók + Viták fülekhez)
  const [stats, setStats] = useState<any>(null);
  const [disputes, setDisputes] = useState<any[]>([]);
  const [paymentLog, setPaymentLog] = useState<any[]>([]);
  const [live, setLive] = useState<Awaited<ReturnType<typeof api.adminLive>> | null>(null);
  const [users, setUsers] = useState<Awaited<ReturnType<typeof api.adminUsers>>>([]);
  const [userSearch, setUserSearch] = useState('');
  const [kycDocs, setKycDocs] = useState<Awaited<ReturnType<typeof api.adminKycDocuments>>>([]);

  // Fuvarok fül (lustán töltve)
  const [jobs, setJobs] = useState<any[] | null>(null);
  const [jobSearch, setJobSearch] = useState('');
  const [jobStatus, setJobStatus] = useState('');
  const [jobBids, setJobBids] = useState<Record<string, any[]>>({});
  const [jobBusy, setJobBusy] = useState<string | null>(null);

  // Járatok + foglalások fül (lustán töltve)
  const [routes, setRoutes] = useState<any[] | null>(null);
  const [bookings, setBookings] = useState<any[] | null>(null);

  // Chat-néző (vitákhoz + fuvarokhoz)
  const [chatView, setChatView] = useState<{ title: string; messages: any[] } | null>(null);

  // Dialógusok
  const [decision, setDecision] = useState<{ id: string; mode: 'no_action' | 'refund' } | null>(null);
  const [kycReject, setKycReject] = useState<{ id: string; name: string } | null>(null);
  const [kycBusy, setKycBusy] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<{ kind: 'job' | 'route' | 'booking' | 'user'; id: string; label: string } | null>(null);

  // ─── Fül a hash-ből (az értesítések /admin#kyc linkje így működik) ───
  useEffect(() => {
    const readHash = () => {
      const h = window.location.hash.replace('#', '') as TabId;
      if (TABS.some((t) => t.id === h)) setTab(h);
    };
    readHash();
    window.addEventListener('hashchange', readHash);
    return () => window.removeEventListener('hashchange', readHash);
  }, []);

  function openTab(id: TabId) {
    setTab(id);
    history.replaceState(null, '', `#${id}`);
  }

  useEffect(() => {
    if (me && me.role !== 'admin') { router.push('/'); return; }
    if (!me) return;
    loadCore();
  }, [me]);

  // Élő jelenlét pollozása
  useEffect(() => {
    if (!me || me.role !== 'admin') return;
    let alive = true;
    const tick = async () => {
      try { const p = await api.adminLive(); if (alive) setLive(p); } catch { /* következő tick */ }
    };
    tick();
    const iv = setInterval(tick, 5000);
    return () => { alive = false; clearInterval(iv); };
  }, [me]);

  // Lusta betöltés fül-váltásra
  useEffect(() => {
    if (!me || me.role !== 'admin') return;
    if (tab === 'fuvarok' && jobs === null) loadJobs();
    if (tab === 'jaratok' && routes === null) loadRoutesBookings();
  }, [tab, me]);

  async function loadCore() {
    setLoading(true);
    try {
      const [s, d, pl, u, k] = await Promise.all([
        api.adminStats(), api.allDisputes(), api.adminPaymentLog(30),
        api.adminUsers(), api.adminKycDocuments('pending'),
      ]);
      setStats(s); setDisputes(d); setPaymentLog(pl); setUsers(u); setKycDocs(k);
    } catch (e: any) {
      toast.error('Hiba', e.message);
    } finally {
      setLoading(false);
    }
  }

  async function loadJobs(status = jobStatus, search = jobSearch) {
    try {
      setJobs(await api.adminJobs({ status: status || undefined, search: search || undefined, limit: 100 }));
    } catch (e: any) { toast.error('Hiba', e.message); }
  }

  async function loadRoutesBookings() {
    try {
      const [r, b] = await Promise.all([api.adminRoutes(100), api.adminBookings(100)]);
      setRoutes(r); setBookings(b);
    } catch (e: any) { toast.error('Hiba', e.message); }
  }

  // ─── Műveletek ───
  async function resolveDispute(id: string, status: string, note: string, refundHuf?: number) {
    try {
      await api.resolveDispute(id, { status, resolution_note: note, refund_huf: refundHuf });
      toast.success('Vita lezárva');
      loadCore();
    } catch (e: any) { toast.error('Hiba', e.message); }
  }

  async function approveKyc(id: string) {
    setKycBusy(id);
    try {
      await api.reviewKyc(id, 'approve');
      toast.success('Jóváhagyva', 'A felhasználó értesítést kapott.');
      setKycDocs((prev) => prev.filter((d) => d.id !== id));
    } catch (e: any) { toast.error('Hiba', e.message); } finally { setKycBusy(null); }
  }

  async function confirmRejectKyc(reason: string) {
    if (!kycReject) return;
    const id = kycReject.id;
    setKycBusy(id);
    try {
      await api.reviewKyc(id, 'reject', reason.trim());
      toast.success('Elutasítva', 'A felhasználó értesítést kapott az indokkal.');
      setKycDocs((prev) => prev.filter((d) => d.id !== id));
      setKycReject(null);
    } catch (e: any) { toast.error('Hiba', e.message); } finally { setKycBusy(null); }
  }

  async function patchUser(id: string, fields: Record<string, unknown>, okMsg: string) {
    try {
      await api.adminUserPatch(id, fields);
      toast.success(okMsg);
      setUsers(await api.adminUsers(userSearch.trim() || undefined));
    } catch (e: any) { toast.error('Hiba', e.message); }
  }

  async function forceLogout(id: string, name: string) {
    try {
      await api.adminForceLogout(id);
      toast.success('Kijelentkeztetve', `${name} minden munkamenete érvénytelenítve.`);
    } catch (e: any) { toast.error('Hiba', e.message); }
  }

  async function toggleHold(entity: { job_id?: string; booking_id?: string }, current: boolean) {
    try {
      const r = await api.adminPhotoHold(entity, !current);
      toast.success(r.photo_retention_hold ? 'Zárolva' : 'Zárolás feloldva',
        r.photo_retention_hold ? 'A fotók/chat 5 évig megőrződnek.' : 'Visszaállt a normál retenció.');
      if (entity.job_id) setJobs((prev) => prev?.map((j) => (j.id === entity.job_id ? { ...j, photo_retention_hold: r.photo_retention_hold } : j)) ?? null);
      if (entity.booking_id) setBookings((prev) => prev?.map((b) => (b.id === entity.booking_id ? { ...b, photo_retention_hold: r.photo_retention_hold } : b)) ?? null);
    } catch (e: any) { toast.error('Hiba', e.message); }
  }

  async function changeJobStatus(id: string, status: string) {
    setJobBusy(id);
    try {
      await api.adminJobPatch(id, status);
      toast.success('Státusz átállítva', JOB_STATUS_LABEL[status] || status);
      setJobs((prev) => prev?.map((j) => (j.id === id ? { ...j, status } : j)) ?? null);
    } catch (e: any) { toast.error('Hiba', e.message); } finally { setJobBusy(null); }
  }

  async function loadBids(jobId: string) {
    if (jobBids[jobId]) { setJobBids((p) => { const n = { ...p }; delete n[jobId]; return n; }); return; }
    try {
      const b = await api.adminJobBids(jobId);
      setJobBids((p) => ({ ...p, [jobId]: b }));
    } catch (e: any) { toast.error('Hiba', e.message); }
  }

  async function openChat(entity: { job_id?: string; booking_id?: string }, title: string) {
    try {
      const msgs = await api.adminMessages(entity);
      setChatView({ title, messages: msgs });
    } catch (e: any) { toast.error('Hiba', e.message); }
  }

  async function doDelete() {
    if (!confirmDelete) return;
    const { kind, id } = confirmDelete;
    try {
      if (kind === 'job') { await api.adminJobDelete(id); setJobs((p) => p?.filter((j) => j.id !== id) ?? null); }
      if (kind === 'route') { await api.adminRouteDelete(id); setRoutes((p) => p?.filter((r) => r.id !== id) ?? null); }
      if (kind === 'booking') { await api.adminBookingDelete(id); setBookings((p) => p?.filter((b) => b.id !== id) ?? null); }
      if (kind === 'user') { await api.adminUserDelete(id); setUsers((p) => p.filter((u) => u.id !== id)); }
      toast.success('Törölve');
    } catch (e: any) { toast.error('Hiba', e.message); }
    setConfirmDelete(null);
  }

  const onlineIds = new Set((live?.users || []).map((u) => u.id));
  const openDisputes = disputes.filter((d) => d.status === 'open' || d.status === 'under_review');

  if (!me) return <Loading />;
  if (me.role !== 'admin') return null;
  if (loading) return <Loading />;

  // Fül-jelvények: hol vár teendő
  const badge: Partial<Record<TabId, number>> = { kyc: kycDocs.length, vitak: openDisputes.length };

  return (
    <div>
      <h1 style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
        <ShieldCheck size={28} color="var(--primary)" /> Admin
      </h1>

      {/* ─── Fül-sáv ─── */}
      <div style={{
        display: 'flex', gap: 6, flexWrap: 'wrap', marginTop: 12,
        borderBottom: '1px solid var(--border)', paddingBottom: 10,
      }}>
        {TABS.map((t) => {
          const Icon = t.icon;
          const active = tab === t.id;
          const b = badge[t.id];
          return (
            <button
              key={t.id}
              type="button"
              onClick={() => openTab(t.id)}
              style={{
                display: 'inline-flex', alignItems: 'center', gap: 6,
                padding: '8px 14px', borderRadius: 10, border: '1px solid',
                borderColor: active ? 'var(--primary)' : 'var(--border)',
                background: active ? 'var(--primary)' : 'var(--surface)',
                color: active ? '#fff' : 'var(--text)',
                fontWeight: 700, fontSize: 13, cursor: 'pointer', transition: 'all 0.15s',
              }}
            >
              <Icon size={15} /> {t.label}
              {b ? (
                <span style={{
                  background: active ? 'rgba(255,255,255,0.25)' : 'var(--danger-strong)',
                  color: '#fff', fontSize: 11, fontWeight: 800,
                  borderRadius: 999, padding: '1px 7px',
                }}>{b}</span>
              ) : null}
            </button>
          );
        })}
      </div>

      {/* ═══════════ ÁTTEKINTÉS ═══════════ */}
      {tab === 'attekintes' && (
        <>
          {/* Élő jelenlét */}
          <div className="card" style={{
            marginTop: 20, display: 'flex', alignItems: 'center', gap: 24, flexWrap: 'wrap',
            borderColor: 'var(--success)',
            background: 'linear-gradient(135deg, rgba(34,197,94,0.08), transparent)',
          }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
              <span aria-hidden style={{
                width: 12, height: 12, borderRadius: '50%', background: 'var(--success)',
                boxShadow: '0 0 0 0 rgba(34,197,94,0.6)', animation: 'gf-pulse 1.6s infinite',
                display: 'inline-block', flexShrink: 0,
              }} />
              <div>
                <div style={{ fontSize: 32, fontWeight: 900, lineHeight: 1 }}>
                  {live ? live.online_users : '—'}
                </div>
                <div className="muted" style={{ fontSize: 13, marginTop: 4 }}>
                  bejelentkezett felhasználó van most az oldalon
                </div>
              </div>
            </div>
            <div className="row" style={{ gap: 20, flexWrap: 'wrap', fontSize: 14 }}>
              <span>{live?.by_role?.shipper ?? 0} feladó</span>
              <span>{live?.by_role?.carrier ?? 0} szállító</span>
              <span>{live?.by_role?.admin ?? 0} admin</span>
              <span className="muted">{live?.anonymous ?? 0} vendég</span>
              <span className="muted">{live?.total_connections ?? 0} kapcsolat</span>
            </div>
            <style>{`@keyframes gf-pulse {
              0% { box-shadow: 0 0 0 0 rgba(34,197,94,0.6); }
              70% { box-shadow: 0 0 0 10px rgba(34,197,94,0); }
              100% { box-shadow: 0 0 0 0 rgba(34,197,94,0); }
            }`}</style>
          </div>

          {/* Statisztikák */}
          {stats && (
            <div style={{
              display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))',
              gap: 16, marginTop: 20,
            }}>
              {[
                { label: 'Összes fuvar', value: stats.total_jobs, color: 'var(--primary-subtle)' },
                { label: 'Aktív fuvar', value: stats.active_jobs, color: 'var(--success-light)' },
                { label: 'Felhasználók', value: stats.total_users, color: 'var(--warning-light)' },
                { label: 'Járatok', value: stats.total_routes, color: 'var(--primary-subtle)' },
                { label: 'Foglalások', value: stats.total_bookings, color: 'var(--warning-light)' },
                { label: 'Nyitott viták', value: stats.open_disputes, color: 'var(--danger-light)' },
              ].map((s) => (
                <div key={s.label} style={{ background: s.color, padding: 18, borderRadius: 16, textAlign: 'center' }}>
                  <div style={{ fontSize: 32, fontWeight: 900 }}>{s.value ?? '—'}</div>
                  <div className="muted" style={{ fontSize: 13, marginTop: 4 }}>{s.label}</div>
                </div>
              ))}
            </div>
          )}

          {/* Fizetési napló */}
          <SectionTitle icon={<Banknote size={20} />}>Fizetési napló (utolsó {paymentLog.length})</SectionTitle>
          {paymentLog.length === 0 && (
            <div className="card"><p className="muted" style={{ margin: 0 }}>Még nincs fizetési esemény.</p></div>
          )}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {paymentLog.map((pe) => (
              <div key={pe.id} className="card" style={{
                padding: 12, marginBottom: 0,
                borderLeft: `4px solid ${
                  pe.status === 'Succeeded' ? 'var(--success)' :
                  pe.status === 'Canceled' || pe.status === 'Expired' ? 'var(--danger)' : 'var(--border)'
                }`,
              }}>
                <div className="row" style={{ justifyContent: 'space-between', alignItems: 'center' }}>
                  <div style={{ flex: 1 }}>
                    <div style={{ fontWeight: 700, fontSize: 14 }}>
                      {pe.job_title || pe.route_title || pe.payment_id?.slice(0, 12)}
                    </div>
                    <div className="muted" style={{ fontSize: 12, marginTop: 2 }}>
                      {pe.summary || `${pe.status} — ${pe.total_amount || '?'} ${pe.currency || 'HUF'}`}
                    </div>
                  </div>
                  <div style={{ textAlign: 'right', flexShrink: 0 }}>
                    {pe.platform_fee != null && (
                      <div style={{ fontWeight: 700, color: 'var(--success-text)', fontSize: 14 }}>
                        +{pe.platform_fee} {pe.currency}
                      </div>
                    )}
                    <div className="muted" style={{ fontSize: 11 }}>
                      {new Date(pe.created_at).toLocaleString('hu-HU')}
                    </div>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </>
      )}

      {/* ═══════════ KYC ═══════════ */}
      {tab === 'kyc' && (
        <>
          <SectionTitle icon={<IdCard size={20} />}>KYC jóváhagyásra vár ({kycDocs.length})</SectionTitle>
          {kycDocs.length === 0 ? (
            <div className="card"><p className="muted" style={{ margin: 0 }}>Nincs függőben lévő dokumentum.</p></div>
          ) : (
            kycDocs.map((doc) => (
              <div key={doc.id} className="card" style={{ marginTop: 12, borderColor: 'var(--warning)' }}>
                <div className="row" style={{ gap: 16, alignItems: 'flex-start', flexWrap: 'wrap' }}>
                  <a href={photoUrl(doc.file_url)} target="_blank" rel="noreferrer"
                    style={{ flexShrink: 0, display: 'block', borderRadius: 8, overflow: 'hidden', border: '1px solid var(--border)' }}
                    title="Megnyitás teljes méretben">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={photoUrl(doc.file_url)} alt="KYC dokumentum"
                      style={{ width: 200, height: 140, objectFit: 'cover', background: 'var(--bg)', display: 'block' }}
                      onError={(e) => { (e.currentTarget as HTMLImageElement).style.opacity = '0.3'; }} />
                  </a>
                  <div style={{ flex: 1, minWidth: 220 }}>
                    <div style={{ fontWeight: 700 }}>{doc.full_name || '—'}</div>
                    <div className="muted" style={{ fontSize: 12 }}>{doc.email}</div>
                    <div style={{ marginTop: 8 }}>
                      <span className="pill pill-progress" style={{ fontWeight: 700, fontSize: 11 }}>
                        {KYC_DOC_LABEL[doc.doc_type] || doc.doc_type}
                      </span>
                    </div>
                    {doc.full_name_on_doc && <div className="muted" style={{ fontSize: 12, marginTop: 6 }}>Okmányon: {doc.full_name_on_doc}</div>}
                    {doc.rejection_reason && (
                      <div style={{ fontSize: 12, marginTop: 6, color: 'var(--warning)' }}>
                        AI/korábbi megjegyzés: {doc.rejection_reason}
                      </div>
                    )}
                    <div className="row" style={{ gap: 8, marginTop: 12, flexWrap: 'wrap' }}>
                      <button className="btn btn-success" disabled={kycBusy === doc.id} onClick={() => approveKyc(doc.id)}>
                        {kycBusy === doc.id ? '…' : 'Jóváhagyom'}
                      </button>
                      <button className="btn btn-danger" disabled={kycBusy === doc.id}
                        onClick={() => setKycReject({ id: doc.id, name: doc.full_name || doc.email })}>
                        Elutasítom
                      </button>
                    </div>
                  </div>
                </div>
              </div>
            ))
          )}
        </>
      )}

      {/* ═══════════ FELHASZNÁLÓK ═══════════ */}
      {tab === 'felhasznalok' && (
        <>
          <SectionTitle icon={<UsersIcon size={20} />}>Felhasználók ({users.length})</SectionTitle>
          <div className="card">
            <div className="row" style={{ gap: 8, marginBottom: 12, flexWrap: 'wrap' }}>
              <input className="input" style={{ flex: 1, minWidth: 200 }}
                placeholder="Keresés név / email / telefon…"
                value={userSearch}
                onChange={(e) => setUserSearch(e.target.value)}
                onKeyDown={async (e) => { if (e.key === 'Enter') setUsers(await api.adminUsers(userSearch.trim() || undefined)); }} />
              <button className="btn btn-ghost" onClick={async () => setUsers(await api.adminUsers(userSearch.trim() || undefined))}>
                <Search size={15} /> Keresés
              </button>
            </div>
            <div style={{ overflowX: 'auto' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13, minWidth: 860 }}>
                <thead>
                  <tr style={{ textAlign: 'left', color: 'var(--muted)', borderBottom: '1px solid var(--border)' }}>
                    <th style={{ padding: '8px 10px' }}>Felhasználó</th>
                    <th style={{ padding: '8px 10px' }}>Szerep</th>
                    <th style={{ padding: '8px 10px' }}>KYC</th>
                    <th style={{ padding: '8px 10px' }}>Utolsó belépés</th>
                    <th style={{ padding: '8px 10px', textAlign: 'right' }}>Aktív idő</th>
                    <th style={{ padding: '8px 10px', textAlign: 'right' }}>Műveletek</th>
                  </tr>
                </thead>
                <tbody>
                  {users.map((u: any) => {
                    const online = onlineIds.has(u.id);
                    return (
                      <tr key={u.id} style={{ borderBottom: '1px solid var(--border)' }}>
                        <td style={{ padding: '8px 10px' }}>
                          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                            <span title={online ? 'Éppen online' : 'Offline'} style={{
                              width: 8, height: 8, borderRadius: '50%', flexShrink: 0,
                              background: online ? 'var(--success)' : 'var(--border)',
                            }} />
                            <div>
                              <div style={{ fontWeight: 600 }}>{u.full_name || '—'}</div>
                              <div className="muted" style={{ fontSize: 11 }}>{u.email}</div>
                            </div>
                          </div>
                        </td>
                        <td style={{ padding: '8px 10px' }}>
                          <select className="input" style={{ width: 110, padding: '4px 8px', fontSize: 12, marginTop: 0 }}
                            value={u.role}
                            onChange={(e) => patchUser(u.id, { role: e.target.value }, 'Szerep átállítva')}>
                            <option value="shipper">shipper</option>
                            <option value="carrier">carrier</option>
                            <option value="admin">admin</option>
                          </select>
                        </td>
                        <td style={{ padding: '8px 10px' }}>
                          <select className="input" style={{ width: 120, padding: '4px 8px', fontSize: 12, marginTop: 0 }}
                            value={u.identity_kyc_status || 'none'}
                            onChange={(e) => patchUser(u.id, { identity_kyc_status: e.target.value }, 'KYC-státusz átállítva')}>
                            <option value="none">nincs</option>
                            <option value="pending">pending</option>
                            <option value="verified">verified</option>
                            <option value="rejected">rejected</option>
                          </select>
                        </td>
                        <td style={{ padding: '8px 10px' }} title={u.last_login_at ? new Date(u.last_login_at).toLocaleString('hu-HU') : 'soha'}>
                          {fmtWhen(u.last_login_at)}
                          <div className="muted" style={{ fontSize: 11 }}>{u.login_count ?? 0} belépés</div>
                        </td>
                        <td style={{ padding: '8px 10px', textAlign: 'right', fontWeight: 600 }}>
                          {fmtActive(u.total_active_seconds)}
                        </td>
                        <td style={{ padding: '8px 10px', textAlign: 'right', whiteSpace: 'nowrap' }}>
                          <button className="btn btn-ghost" style={{ padding: '5px 9px', fontSize: 12 }}
                            title="Kijelentkeztetés minden eszközről (token-érvénytelenítés)"
                            onClick={() => forceLogout(u.id, u.full_name || u.email)}>
                            <LogOut size={13} />
                          </button>{' '}
                          <button className="btn btn-ghost" style={{ padding: '5px 9px', fontSize: 12, color: 'var(--danger-text)' }}
                            title="Fiók törlése"
                            onClick={() => setConfirmDelete({ kind: 'user', id: u.id, label: u.full_name || u.email })}>
                            <Trash2 size={13} />
                          </button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            <p className="muted" style={{ fontSize: 11, marginTop: 10, marginBottom: 0 }}>
              A szerep/KYC legördülők azonnal mentenek. A zöld pont = éppen online.
            </p>
          </div>
        </>
      )}

      {/* ═══════════ FUVAROK ═══════════ */}
      {tab === 'fuvarok' && (
        <>
          <SectionTitle icon={<Package size={20} />}>Fuvarok</SectionTitle>
          <div className="row" style={{ gap: 8, flexWrap: 'wrap', marginBottom: 12 }}>
            <input className="input" style={{ flex: 1, minWidth: 220 }}
              placeholder="Keresés cím / feladó email / név / ID…"
              value={jobSearch}
              onChange={(e) => setJobSearch(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') loadJobs(jobStatus, jobSearch); }} />
            <select className="input" style={{ width: 180, marginTop: 0 }}
              value={jobStatus}
              onChange={(e) => { setJobStatus(e.target.value); loadJobs(e.target.value, jobSearch); }}>
              <option value="">Minden státusz</option>
              {JOB_STATUSES.map((s) => <option key={s} value={s}>{JOB_STATUS_LABEL[s]}</option>)}
            </select>
            <button className="btn btn-ghost" onClick={() => loadJobs()}><Search size={15} /> Keresés</button>
            <button className="btn btn-ghost" onClick={() => loadJobs(jobStatus, jobSearch)} title="Frissítés">
              <RefreshCw size={15} />
            </button>
          </div>

          {jobs === null && <ListSkeleton rows={4} />}
          {jobs !== null && jobs.length === 0 && (
            <EmptyState title="Nincs találat" description="Módosíts a keresésen vagy a státusz-szűrőn." />
          )}
          {jobs?.map((j) => (
            <div key={j.id} className="card" style={{ marginBottom: 10 }}>
              <div className="row" style={{ justifyContent: 'space-between', alignItems: 'flex-start', gap: 10 }}>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontWeight: 700 }}>{j.title}</div>
                  <div className="muted" style={{ fontSize: 12, marginTop: 2 }}>
                    {j.pickup_address?.split(',')[0]} → {j.dropoff_address?.split(',')[0]}
                    {j.distance_km != null ? ` · ${j.distance_km} km` : ''}
                  </div>
                  <div className="muted" style={{ fontSize: 12, marginTop: 2 }}>
                    Feladó: <strong>{j.shipper_name}</strong> ({j.shipper_email}) ·
                    Szállító: <strong>{j.carrier_name || '—'}</strong>
                  </div>
                  <div className="muted" style={{ fontSize: 11, marginTop: 2 }}>
                    {new Date(j.created_at).toLocaleString('hu-HU')} · {j.id}
                    {j.paid_at && <span style={{ color: 'var(--success-text)', fontWeight: 700 }}> · DÍJ FIZETVE</span>}
                    {j.photo_retention_hold && <span style={{ color: 'var(--warning)', fontWeight: 700 }}> · ZÁROLT (5 év)</span>}
                  </div>
                </div>
                <div style={{ textAlign: 'right', flexShrink: 0 }}>
                  <div className="price" style={{ fontSize: 16 }}>
                    {(j.accepted_price_huf || j.suggested_price_huf || 0).toLocaleString('hu-HU')} Ft
                  </div>
                  <select className="input" style={{ width: 150, padding: '4px 8px', fontSize: 12, marginTop: 6 }}
                    value={j.status} disabled={jobBusy === j.id}
                    onChange={(e) => changeJobStatus(j.id, e.target.value)}>
                    {JOB_STATUSES.map((s) => <option key={s} value={s}>{JOB_STATUS_LABEL[s]}</option>)}
                  </select>
                </div>
              </div>
              <div className="row" style={{ gap: 6, marginTop: 10, flexWrap: 'wrap' }}>
                <button className="btn btn-ghost" style={{ fontSize: 12, padding: '5px 10px' }}
                  onClick={() => loadBids(j.id)}>
                  {jobBids[j.id] ? 'Ajánlatok elrejtése' : 'Ajánlatok'}
                </button>
                <button className="btn btn-ghost" style={{ fontSize: 12, padding: '5px 10px' }}
                  onClick={() => openChat({ job_id: j.id }, j.title)}>
                  <MessageSquare size={13} /> Chat
                </button>
                <button className="btn btn-ghost" style={{ fontSize: 12, padding: '5px 10px' }}
                  title={j.photo_retention_hold ? 'Zárolás feloldása (30 napos retenció)' : 'Fotók+chat zárolása 5 évre'}
                  onClick={() => toggleHold({ job_id: j.id }, !!j.photo_retention_hold)}>
                  {j.photo_retention_hold ? <><Unlock size={13} /> Zárolás feloldása</> : <><Lock size={13} /> Zárolás</>}
                </button>
                <button className="btn btn-ghost" style={{ fontSize: 12, padding: '5px 10px', color: 'var(--danger-text)' }}
                  onClick={() => setConfirmDelete({ kind: 'job', id: j.id, label: j.title })}>
                  <Trash2 size={13} /> Törlés
                </button>
              </div>
              {jobBids[j.id] && (
                <div style={{ marginTop: 10, borderTop: '1px solid var(--border)', paddingTop: 8 }}>
                  {jobBids[j.id].length === 0 && <p className="muted" style={{ margin: 0, fontSize: 13 }}>Nincs ajánlat.</p>}
                  {jobBids[j.id].map((b: any) => (
                    <div key={b.id} className="row" style={{ justifyContent: 'space-between', fontSize: 13, padding: '4px 0' }}>
                      <span>{b.carrier_name || b.carrier_id} <span className="muted">({b.status})</span></span>
                      <strong>{Number(b.amount_huf).toLocaleString('hu-HU')} Ft</strong>
                    </div>
                  ))}
                </div>
              )}
            </div>
          ))}
        </>
      )}

      {/* ═══════════ JÁRATOK & FOGLALÁSOK ═══════════ */}
      {tab === 'jaratok' && (
        <>
          <SectionTitle icon={<RouteIcon size={20} />}>Járatok ({routes?.length ?? '…'})</SectionTitle>
          {routes === null && <ListSkeleton rows={3} />}
          {routes !== null && routes.length === 0 && (
            <div className="card"><p className="muted" style={{ margin: 0 }}>Nincs járat.</p></div>
          )}
          {routes?.map((r) => (
            <div key={r.id} className="card" style={{ marginBottom: 8, padding: 14 }}>
              <div className="row" style={{ justifyContent: 'space-between', alignItems: 'center', gap: 10 }}>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontWeight: 700, fontSize: 14 }}>{r.title}</div>
                  <div className="muted" style={{ fontSize: 12 }}>
                    Szállító: {r.carrier_name || r.carrier_id} · {r.status}
                    {r.departure_at ? ` · ${new Date(r.departure_at).toLocaleString('hu-HU')}` : ''}
                  </div>
                </div>
                <button className="btn btn-ghost" style={{ fontSize: 12, padding: '5px 10px', color: 'var(--danger-text)' }}
                  onClick={() => setConfirmDelete({ kind: 'route', id: r.id, label: r.title })}>
                  <Trash2 size={13} /> Törlés
                </button>
              </div>
            </div>
          ))}

          <SectionTitle icon={<Package size={20} />}>Foglalások ({bookings?.length ?? '…'})</SectionTitle>
          {bookings === null && <ListSkeleton rows={3} />}
          {bookings !== null && bookings.length === 0 && (
            <div className="card"><p className="muted" style={{ margin: 0 }}>Nincs foglalás.</p></div>
          )}
          {bookings?.map((b) => (
            <div key={b.id} className="card" style={{ marginBottom: 8, padding: 14 }}>
              <div className="row" style={{ justifyContent: 'space-between', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontWeight: 700, fontSize: 14 }}>{b.route_title || 'Foglalás'}</div>
                  <div className="muted" style={{ fontSize: 12 }}>
                    Feladó: {b.shipper_name || b.shipper_id} · {b.status}
                    {b.paid_at && <span style={{ color: 'var(--success-text)', fontWeight: 700 }}> · FIZETVE</span>}
                    {b.photo_retention_hold && <span style={{ color: 'var(--warning)', fontWeight: 700 }}> · ZÁROLT</span>}
                  </div>
                </div>
                <div className="row" style={{ gap: 6 }}>
                  <button className="btn btn-ghost" style={{ fontSize: 12, padding: '5px 10px' }}
                    onClick={() => openChat({ booking_id: b.id }, b.route_title || 'Foglalás')}>
                    <MessageSquare size={13} />
                  </button>
                  <button className="btn btn-ghost" style={{ fontSize: 12, padding: '5px 10px' }}
                    title={b.photo_retention_hold ? 'Zárolás feloldása' : 'Zárolás 5 évre'}
                    onClick={() => toggleHold({ booking_id: b.id }, !!b.photo_retention_hold)}>
                    {b.photo_retention_hold ? <Unlock size={13} /> : <Lock size={13} />}
                  </button>
                  <button className="btn btn-ghost" style={{ fontSize: 12, padding: '5px 10px', color: 'var(--danger-text)' }}
                    onClick={() => setConfirmDelete({ kind: 'booking', id: b.id, label: b.route_title || b.id })}>
                    <Trash2 size={13} />
                  </button>
                </div>
              </div>
            </div>
          ))}
        </>
      )}

      {/* ═══════════ VITÁK ═══════════ */}
      {tab === 'vitak' && (
        <>
          <SectionTitle icon={<Scale size={20} />}>Nyitott viták ({openDisputes.length})</SectionTitle>
          {openDisputes.length === 0 && (
            <div className="card"><p className="muted" style={{ margin: 0 }}>Nincs nyitott vita.</p></div>
          )}
          {openDisputes.map((d) => (
            <div key={d.id} className="card" style={{ marginTop: 12 }}>
              <div className="row" style={{ justifyContent: 'space-between', alignItems: 'start' }}>
                <div style={{ flex: 1 }}>
                  <h3 style={{ marginTop: 0 }}>{d.job_title || d.route_title || 'Vita'}</h3>
                  <p className="muted" style={{ margin: '4px 0' }}>
                    Nyitotta: <strong>{d.opened_by_name || 'Ismeretlen'}</strong> ↔ {d.against_name || '?'}
                  </p>
                  <p style={{ margin: '8px 0' }}>{d.description}</p>
                  <span className="pill" style={{
                    background: d.status === 'open' ? 'var(--danger-light)' : 'var(--warning-light)',
                    fontWeight: 700,
                  }}>
                    {d.status === 'open' ? 'Nyitott' : 'Felülvizsgálat alatt'}
                  </span>
                  <p className="muted" style={{ fontSize: 11, marginTop: 8, marginBottom: 0 }}>
                    A vita-nyitás automatikusan zárolta a fuvar fotóit/chatjét (5 éves megőrzés).
                  </p>
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                  {(d.job_id || d.booking_id) && (
                    <button className="btn btn-secondary" style={{ fontSize: 12, padding: '6px 12px' }}
                      onClick={() => openChat(d.job_id ? { job_id: d.job_id } : { booking_id: d.booking_id }, d.job_title || d.route_title || 'Vita')}>
                      <MessageSquare size={13} /> A felek chatje
                    </button>
                  )}
                  <button className="btn btn-success" style={{ fontSize: 12, padding: '6px 12px' }}
                    onClick={() => setDecision({ id: d.id, mode: 'no_action' })}>
                    Nincs teendő
                  </button>
                  <button className="btn btn-warning" style={{ fontSize: 12, padding: '6px 12px' }}
                    onClick={() => setDecision({ id: d.id, mode: 'refund' })}>
                    Visszatérítés
                  </button>
                  <button className="btn btn-ghost" style={{ fontSize: 12, padding: '6px 12px' }}
                    onClick={() => resolveDispute(d.id, 'under_review', 'Admin felülvizsgálat folyamatban')}>
                    Vizsgálat
                  </button>
                </div>
              </div>
            </div>
          ))}

          <SectionTitle icon={<CircleDot size={18} />}>Lezárt viták</SectionTitle>
          {disputes.filter((d) => d.status !== 'open' && d.status !== 'under_review').slice(0, 20).map((d) => (
            <div key={d.id} className="card" style={{ marginTop: 8, opacity: 0.7, padding: 12 }}>
              <div className="row" style={{ gap: 12, alignItems: 'center' }}>
                <span className="pill" style={{ background: 'var(--success-light)', fontWeight: 700 }}>
                  {d.status === 'resolved_refund' ? 'Visszatérítés' :
                   d.status === 'resolved_no_action' ? 'Nincs teendő' :
                   d.status === 'closed' ? 'Lezárva' : d.status}
                </span>
                <span style={{ fontSize: 14 }}>{d.job_title || d.route_title || 'Vita'}</span>
                <span className="muted" style={{ fontSize: 13 }}>{d.resolution_note || ''}</span>
              </div>
            </div>
          ))}
        </>
      )}

      {/* ─── Chat-néző panel ─── */}
      {chatView && (
        <div
          style={{
            position: 'fixed', inset: 0, zIndex: 9000, background: 'rgba(0,0,0,0.5)',
            display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16,
          }}
          onClick={(e) => { if (e.target === e.currentTarget) setChatView(null); }}
        >
          <div className="card" style={{ maxWidth: 560, width: '100%', maxHeight: '80vh', overflowY: 'auto', margin: 0 }}>
            <div className="row" style={{ justifyContent: 'space-between', alignItems: 'center' }}>
              <h3 style={{ margin: 0, display: 'flex', alignItems: 'center', gap: 8 }}>
                <MessageSquare size={18} /> Chat — {chatView.title}
              </h3>
              <button className="btn btn-ghost" style={{ padding: '4px 10px' }} onClick={() => setChatView(null)}>Bezárás</button>
            </div>
            <div style={{ marginTop: 12, display: 'flex', flexDirection: 'column', gap: 8 }}>
              {chatView.messages.length === 0 && <p className="muted">Nincs üzenet ebben a beszélgetésben.</p>}
              {chatView.messages.map((m) => (
                <div key={m.id} style={{
                  background: 'var(--surface-hover)', borderRadius: 10, padding: '8px 12px',
                }}>
                  <div style={{ fontSize: 12, fontWeight: 700 }}>
                    {m.sender_name}
                    <span className="muted" style={{ fontWeight: 400, marginLeft: 8 }}>
                      {new Date(m.created_at).toLocaleString('hu-HU')}
                    </span>
                  </div>
                  <div style={{ fontSize: 14, marginTop: 2, whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>{m.body}</div>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* ─── Dialógusok ─── */}
      <ConfirmDialog
        open={!!decision}
        title={decision?.mode === 'refund' ? 'Visszatérítés a feladónak' : 'Vita lezárása — nincs teendő'}
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

      <ConfirmDialog
        open={!!kycReject}
        title={`KYC elutasítása — ${kycReject?.name || ''}`}
        message="Az elutasításról a felhasználó értesítést kap az alábbi indokkal."
        confirmLabel="Elutasítás"
        fields={[
          { key: 'reason', label: 'Indok', type: 'textarea', required: true, placeholder: 'pl. A kép olvashatatlan / nem érvényes okmány' },
        ]}
        onConfirm={(v) => confirmRejectKyc(v.reason || '')}
        onClose={() => setKycReject(null)}
      />

      <ConfirmDialog
        open={!!confirmDelete}
        title={`Végleges törlés — ${confirmDelete?.label || ''}`}
        message={confirmDelete?.kind === 'user'
          ? 'A fiók és a hozzá tartozó adatok véglegesen törlődnek. Ez nem visszavonható!'
          : 'A rekord és a kapcsolódó adatok (fotók, üzenetek, ajánlatok) véglegesen törlődnek. Ez nem visszavonható!'}
        confirmLabel="Végleges törlés"
        onConfirm={() => doDelete()}
        onClose={() => setConfirmDelete(null)}
      />
    </div>
  );
}
