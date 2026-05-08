'use client';

// Admin file-hozzáférés audit log nézegető.
// Hatóság vagy felhasználói adatigénylés esetén lekérhető listázás:
//   - melyik file-hoz ki, mikor, milyen IP-ről fért hozzá
//   - sikeres és sikertelen kísérletek egyaránt
//
// Szűrési lehetőségek query-paraméterrel: ?file_id=... vagy ?user_id=...
import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { api } from '@/api';
import { useCurrentUser } from '@/lib/auth';
import { useToast } from '@/components/ToastProvider';

const RESULT_LABEL: Record<string, { label: string; color: string }> = {
  ok:            { label: 'sikeres',           color: 'var(--success)' },
  forbidden:     { label: 'megtagadva',         color: 'var(--danger)' },
  not_found:     { label: 'nincs ilyen',        color: 'var(--muted)' },
  deleted:       { label: 'törölt',             color: 'var(--muted)' },
  token_invalid: { label: 'érvénytelen token',  color: 'var(--danger)' },
};

export default function AdminAuditPage() {
  const me = useCurrentUser();
  const router = useRouter();
  const toast = useToast();
  const params = useSearchParams();
  const fileFilter = params.get('file_id') || '';
  const userFilter = params.get('user_id') || '';
  const [logs, setLogs] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (me === undefined) return;
    if (!me || me.role !== 'admin') {
      router.push('/');
      return;
    }
    setLoading(true);
    api.adminFileAccessLog({
      file_id: fileFilter || undefined,
      user_id: userFilter || undefined,
      limit: 200,
    })
      .then(setLogs)
      .catch((e: any) => toast.error('Hiba', e.message))
      .finally(() => setLoading(false));
  }, [me, fileFilter, userFilter]);

  if (loading) return <p>Betöltés…</p>;

  return (
    <div style={{ maxWidth: 1100, margin: '0 auto' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
        <h1 style={{ margin: 0 }}>File-hozzáférés audit</h1>
        <Link href="/admin" style={{ color: 'var(--muted)', textDecoration: 'none' }}>← Admin főoldal</Link>
      </div>

      <p className="muted" style={{ marginBottom: 16 }}>
        Minden tényleges file-letöltést és minden megtagadott próbálkozást rögzítünk
        ({logs.length} bejegyzés a legutóbbi 200-ból).
      </p>

      {(fileFilter || userFilter) && (
        <div style={{ marginBottom: 12 }}>
          <span style={{ background: 'var(--surface)', padding: '4px 10px', borderRadius: 999, fontSize: 13, marginRight: 8 }}>
            {fileFilter ? `file_id: ${fileFilter}` : `user_id: ${userFilter}`}
          </span>
          <Link href="/admin/audit" style={{ fontSize: 13 }}>(szűrés törlése)</Link>
        </div>
      )}

      <div style={{ overflowX: 'auto' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
          <thead>
            <tr style={{ background: 'var(--surface)', textAlign: 'left' }}>
              <th style={{ padding: 10, borderBottom: '1px solid var(--border)' }}>Időpont</th>
              <th style={{ padding: 10, borderBottom: '1px solid var(--border)' }}>Eredmény</th>
              <th style={{ padding: 10, borderBottom: '1px solid var(--border)' }}>Hozzáférő</th>
              <th style={{ padding: 10, borderBottom: '1px solid var(--border)' }}>File típus</th>
              <th style={{ padding: 10, borderBottom: '1px solid var(--border)' }}>IP</th>
              <th style={{ padding: 10, borderBottom: '1px solid var(--border)' }}>User-Agent</th>
            </tr>
          </thead>
          <tbody>
            {logs.length === 0 && (
              <tr><td colSpan={6} style={{ padding: 24, textAlign: 'center', color: 'var(--muted)' }}>
                Nincs naplóbejegyzés.
              </td></tr>
            )}
            {logs.map((l) => {
              const r = RESULT_LABEL[l.result] || { label: l.result, color: 'var(--muted)' };
              return (
                <tr key={l.id} style={{ borderBottom: '1px solid var(--border)' }}>
                  <td style={{ padding: 10 }}>
                    {new Date(l.accessed_at).toLocaleString('hu-HU')}
                  </td>
                  <td style={{ padding: 10 }}>
                    <span style={{ color: r.color, fontWeight: 700 }}>{r.label}</span>
                  </td>
                  <td style={{ padding: 10 }}>
                    {l.accessor_id ? (
                      <Link href={`/admin/audit?user_id=${l.accessor_id}`}>
                        {l.accessor_name || l.accessor_email || l.accessor_id.slice(0, 8)}
                      </Link>
                    ) : <em style={{ color: 'var(--muted)' }}>—</em>}
                  </td>
                  <td style={{ padding: 10 }}>
                    {l.file_id ? (
                      <Link href={`/admin/audit?file_id=${l.file_id}`}>
                        {l.file_kind || l.file_id.slice(0, 8)}
                      </Link>
                    ) : <em style={{ color: 'var(--muted)' }}>—</em>}
                  </td>
                  <td style={{ padding: 10, fontFamily: 'monospace', fontSize: 12 }}>{l.ip || '—'}</td>
                  <td style={{ padding: 10, fontSize: 12, maxWidth: 240, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={l.user_agent}>
                    {l.user_agent || '—'}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <p className="muted" style={{ fontSize: 11, marginTop: 16 }}>
        Hatósági kérésnél / felhasználói adatigénylésnél ezt a listát exportáljuk
        (a megfelelő szűréssel). A logok 1 évig őrződnek meg.
      </p>
    </div>
  );
}
