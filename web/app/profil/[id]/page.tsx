'use client';

// Publikus felhasználói profil — bárki megnézheti egy másik user
// statisztikáit, értékeléseit, járműadatait. A licit kártyákról
// ide kattint a feladó, hogy eldöntse kit fogad el.
import { useEffect, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { api } from '@/api';

const API = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:4000';
function avatarSrc(url?: string) {
  if (!url) return '';
  if (url.startsWith('http') || url.startsWith('data:')) return url;
  return `${API}${url}`;
}

export default function PublikusProfil() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const [profile, setProfile] = useState<any>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api.getUserProfile(id)
      .then(setProfile)
      .catch((e) => setError(e.message));
  }, [id]);

  if (error) return <div className="card" style={{ borderColor: 'var(--danger)' }}>Hiba: {error}</div>;
  if (!profile) return <p>Betöltés…</p>;

  const memberSince = new Date(profile.created_at).toLocaleDateString('hu-HU', {
    year: 'numeric', month: 'long',
  });
  const totalDeliveries = (profile.completed_jobs || 0) + (profile.completed_route_deliveries || 0);

  return (
    <div style={{ maxWidth: 640 }}>
      <button className="btn btn-secondary" onClick={() => router.back()} style={{ marginBottom: 16 }}>
        ← Vissza
      </button>

      {/* Fejléc */}
      <div style={{ display: 'flex', gap: 24, alignItems: 'center', marginBottom: 32 }}>
        {profile.avatar_url ? (
          <img
            src={avatarSrc(profile.avatar_url)}
            alt=""
            style={{ width: 88, height: 88, borderRadius: '50%', objectFit: 'cover', border: '3px solid var(--primary)' }}
          />
        ) : (
          <div
            style={{
              width: 88, height: 88, borderRadius: '50%',
              background: 'linear-gradient(135deg, #1e40af, #3b82f6)',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              fontSize: 36, color: '#fff', fontWeight: 800,
            }}
          >
            {(profile.full_name || '?').charAt(0).toUpperCase()}
          </div>
        )}
        <div>
          <h1 style={{ margin: 0 }}>{profile.full_name}</h1>
          <p className="muted" style={{ margin: '4px 0' }}>Tag {memberSince} óta</p>
          <div style={{ display: 'flex', gap: 12, marginTop: 8, flexWrap: 'wrap' }}>
            {profile.rating_count > 0 && (
              <span style={{ background: 'var(--surface)', border: '1px solid var(--border)', padding: '4px 12px', borderRadius: 999, fontWeight: 700, fontSize: 14, color: 'var(--text)' }}>
                ⭐ {Number(profile.rating_avg).toFixed(1)} ({profile.rating_count} értékelés)
              </span>
            )}
            <span style={{ background: 'var(--surface)', border: '1px solid var(--border)', padding: '4px 12px', borderRadius: 999, fontWeight: 700, fontSize: 14, color: 'var(--text)' }}>
              ✅ {totalDeliveries} sikeres fuvar
            </span>
          </div>
        </div>
      </div>

      {/* Bio */}
      {profile.bio && (
        <div className="card">
          <h2 style={{ marginTop: 0 }}>Bemutatkozás</h2>
          <p style={{ margin: 0, whiteSpace: 'pre-wrap' }}>{profile.bio}</p>
        </div>
      )}

      {/* Jármű */}
      {(profile.vehicle_type || profile.vehicle_plate) && (
        <div className="card" style={{ marginTop: 16 }}>
          <h2 style={{ marginTop: 0 }}>🚛 Jármű</h2>
          <div className="row" style={{ gap: 24 }}>
            {profile.vehicle_type && (
              <div>
                <div className="muted" style={{ fontSize: 12 }}>Típus</div>
                <strong>{profile.vehicle_type}</strong>
              </div>
            )}
            {profile.vehicle_plate && (
              <div>
                <div className="muted" style={{ fontSize: 12 }}>Rendszám</div>
                <strong>{profile.vehicle_plate}</strong>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Értékelések */}
      <div className="card" style={{ marginTop: 16 }}>
        <h2 style={{ marginTop: 0 }}>⭐ Értékelések ({profile.rating_count || 0})</h2>
        {(!profile.recent_reviews || profile.recent_reviews.length === 0) ? (
          <p className="muted">Még nincs értékelés.</p>
        ) : (
          profile.recent_reviews.map((r: any, i: number) => (
            <div key={i} style={{ borderBottom: '1px solid var(--border)', padding: '10px 0' }}>
              <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                <span style={{ color: '#f59e0b', fontSize: 14 }}>
                  {'★'.repeat(r.stars || 0)}{'☆'.repeat(5 - (r.stars || 0))}
                </span>
                <strong style={{ fontSize: 13 }}>{r.reviewer_name}</strong>
                <span className="muted" style={{ fontSize: 11 }}>
                  {new Date(r.created_at).toLocaleDateString('hu-HU')}
                </span>
              </div>
              {r.comment && <p className="muted" style={{ margin: '4px 0 0', fontSize: 13 }}>{r.comment}</p>}
            </div>
          ))
        )}
      </div>

      {/* Statisztikák */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 12, marginTop: 16 }}>
        <div className="card" style={{ textAlign: 'center', padding: 16 }}>
          <div style={{ fontSize: 28, fontWeight: 900, color: 'var(--primary)' }}>{profile.completed_jobs || 0}</div>
          <div className="muted" style={{ fontSize: 12 }}>Licites fuvar</div>
        </div>
        <div className="card" style={{ textAlign: 'center', padding: 16 }}>
          <div style={{ fontSize: 28, fontWeight: 900, color: 'var(--primary)' }}>{profile.completed_route_deliveries || 0}</div>
          <div className="muted" style={{ fontSize: 12 }}>Fix áras kézbesítés</div>
        </div>
        <div className="card" style={{ textAlign: 'center', padding: 16 }}>
          <div style={{ fontSize: 28, fontWeight: 900, color: '#f59e0b' }}>
            {profile.rating_count > 0 ? Number(profile.rating_avg).toFixed(1) : '—'}
          </div>
          <div className="muted" style={{ fontSize: 12 }}>Átlag értékelés</div>
        </div>
      </div>
    </div>
  );
}
