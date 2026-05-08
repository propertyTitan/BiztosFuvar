'use client';

// Admin KYC review oldal.
// - Lekéri a `pending` státuszú dokumentumokat
// - Mutatja a feltöltött jogosítvány-fotót (a privát file kapun keresztül)
// - 1 kattintás: jóváhagy / elutasít (utóbbihoz indok kötelező)
import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { api } from '@/api';
import { useCurrentUser } from '@/lib/auth';
import { useToast } from '@/components/ToastProvider';
import RemoteImage from '@/components/RemoteImage';

export default function AdminKycPage() {
  const me = useCurrentUser();
  const router = useRouter();
  const toast = useToast();
  const [docs, setDocs] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (me === undefined) return;
    if (!me || me.role !== 'admin') {
      router.push('/');
      return;
    }
    load();
  }, [me]);

  async function load() {
    setLoading(true);
    try {
      const r = await api.adminListPendingKyc();
      setDocs(r);
    } catch (e: any) {
      toast.error('Hiba', e.message);
    } finally {
      setLoading(false);
    }
  }

  async function approve(docId: string) {
    if (!window.confirm('Biztos jóváhagyod ezt a jogosítványt?')) return;
    try {
      await api.adminApproveKyc(docId);
      toast.success('Jóváhagyva');
      load();
    } catch (e: any) {
      toast.error('Hiba', e.message);
    }
  }

  async function reject(docId: string) {
    const reason = window.prompt('Indokold meg az elutasítást (a felhasználó megkapja):');
    if (!reason) return;
    try {
      await api.adminRejectKyc(docId, reason);
      toast.success('Elutasítva');
      load();
    } catch (e: any) {
      toast.error('Hiba', e.message);
    }
  }

  if (loading) return <p>Betöltés…</p>;

  return (
    <div style={{ maxWidth: 960, margin: '0 auto' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
        <h1 style={{ margin: 0 }}>KYC ellenőrzés</h1>
        <Link href="/admin" style={{ color: 'var(--muted)', textDecoration: 'none' }}>← Admin főoldal</Link>
      </div>

      <p className="muted">
        {docs.length === 0
          ? 'Jelenleg nincs ellenőrzésre váró dokumentum. ✨'
          : `${docs.length} függőben lévő hitelesítés.`}
      </p>

      <div style={{ display: 'grid', gap: 16 }}>
        {docs.map((d) => (
          <div
            key={d.id}
            className="card"
            style={{ display: 'grid', gridTemplateColumns: '320px 1fr', gap: 16 }}
          >
            {/* Bal: a feltöltött fotó. Privát file kapun keresztül kerül elő. */}
            <div
              style={{
                background: '#000', borderRadius: 8, aspectRatio: '4 / 3',
                display: 'flex', alignItems: 'center', justifyContent: 'center', overflow: 'hidden',
              }}
            >
              {d.file_id ? (
                <RemoteImage
                  fileId={d.file_id}
                  alt="Jogosítvány"
                  style={{ width: '100%', height: '100%', objectFit: 'contain' }}
                  placeholder={<span style={{ color: '#888' }}>Betöltés…</span>}
                />
              ) : (
                <span style={{ color: '#888' }}>Nincs fotó (törölve / lejárat utáni purge)</span>
              )}
            </div>

            {/* Jobb: meta + akciók */}
            <div>
              <div style={{ marginBottom: 12 }}>
                <div className="muted" style={{ fontSize: 12 }}>Felhasználó</div>
                <div style={{ fontWeight: 700 }}>
                  <Link href={`/profil/${d.user_id}`}>{d.full_name}</Link>
                </div>
                <div className="muted" style={{ fontSize: 13 }}>{d.email}</div>
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginBottom: 16 }}>
                <div>
                  <div className="muted" style={{ fontSize: 12 }}>Név a doksin</div>
                  <strong>{d.full_name_on_doc || '—'}</strong>
                </div>
                <div>
                  <div className="muted" style={{ fontSize: 12 }}>Okmányszám</div>
                  <strong>{d.doc_number || '—'}</strong>
                </div>
                <div>
                  <div className="muted" style={{ fontSize: 12 }}>Lejárat</div>
                  <strong>
                    {d.expiry_date ? new Date(d.expiry_date).toLocaleDateString('hu-HU') : '—'}
                  </strong>
                </div>
                <div>
                  <div className="muted" style={{ fontSize: 12 }}>Beadva</div>
                  <strong>{new Date(d.created_at).toLocaleString('hu-HU')}</strong>
                </div>
              </div>

              <div style={{ display: 'flex', gap: 8 }}>
                <button
                  className="btn"
                  onClick={() => approve(d.id)}
                  style={{ background: 'var(--success)', color: '#fff' }}
                >
                  ✅ Jóváhagyom
                </button>
                <button
                  className="btn btn-secondary"
                  onClick={() => reject(d.id)}
                  style={{ background: 'var(--danger)', color: '#fff' }}
                >
                  ❌ Elutasítom
                </button>
              </div>

              <p className="muted" style={{ fontSize: 11, marginTop: 12, marginBottom: 0 }}>
                Az ellenőrzés naplózódik a `file_access_log` táblában (ki, mikor látta).
                A fotó <strong>30 nappal jóváhagyás után automatikusan törlődik</strong> (adat-minimalizálás).
              </p>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
