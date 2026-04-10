'use client';

// Profil oldal — a bejelentkezett user megnézheti és szerkesztheti a
// saját adatait: név, telefon, jármű (opcionális), bemutatkozás.
// Nincs "sofőr vs feladó" választás — bárki egyformán hozzáfér mindkét
// funkcióhoz, a jármű adatok opcionálisak.
import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { api } from '@/api';
import { useCurrentUser } from '@/lib/auth';
import { useToast } from '@/components/ToastProvider';

export default function ProfilOldal() {
  const router = useRouter();
  const me = useCurrentUser();
  const toast = useToast();
  const [profile, setProfile] = useState<any>(null);
  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState(false);

  // Form state
  const [fullName, setFullName] = useState('');
  const [phone, setPhone] = useState('');
  const [vehicleType, setVehicleType] = useState('');
  const [vehiclePlate, setVehiclePlate] = useState('');
  const [bio, setBio] = useState('');

  useEffect(() => {
    if (!me) return;
    api.getMyProfile().then((p) => {
      setProfile(p);
      setFullName(p.full_name || '');
      setPhone(p.phone || '');
      setVehicleType(p.vehicle_type || '');
      setVehiclePlate(p.vehicle_plate || '');
      setBio(p.bio || '');
    });
  }, [me]);

  async function save() {
    setSaving(true);
    try {
      const updated = await api.updateMyProfile({
        full_name: fullName.trim(),
        phone: phone.trim(),
        vehicle_type: vehicleType.trim(),
        vehicle_plate: vehiclePlate.trim(),
        bio: bio.trim(),
      });
      setProfile(updated);
      setEditing(false);
      toast.success('Profil mentve');
    } catch (e: any) {
      toast.error('Hiba', e.message);
    } finally {
      setSaving(false);
    }
  }

  if (!me) {
    router.push('/bejelentkezes');
    return null;
  }
  async function uploadAvatar(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    const formData = new FormData();
    formData.append('file', file);
    try {
      toast.info('Profilkép feltöltése…');
      const token = window.localStorage.getItem('gofuvar_token');
      const res = await fetch(
        `${process.env.NEXT_PUBLIC_API_URL || 'http://localhost:4000'}/auth/avatar`,
        {
          method: 'POST',
          headers: token ? { Authorization: `Bearer ${token}` } : undefined,
          body: formData,
        },
      );
      if (!res.ok) throw new Error('Feltöltés sikertelen');
      const { url } = await res.json();
      const updated = await api.updateMyProfile({ avatar_url: url });
      setProfile(updated);
      toast.success('Profilkép mentve!');
    } catch (err: any) {
      toast.error('Hiba', err.message);
    }
  }

  if (!profile) return <p>Betöltés…</p>;

  const memberSince = new Date(profile.created_at).toLocaleDateString('hu-HU', {
    year: 'numeric',
    month: 'long',
  });

  return (
    <div style={{ maxWidth: 640 }}>
      {/* Fejléc: avatar + név + rating */}
      <div
        style={{
          display: 'flex',
          gap: 24,
          alignItems: 'center',
          marginBottom: 32,
        }}
      >
        {/* Avatar — kattintásra profilkép feltöltés */}
        <label
          style={{
            position: 'relative',
            width: 88,
            height: 88,
            borderRadius: '50%',
            flexShrink: 0,
            cursor: 'pointer',
            display: 'block',
          }}
          title="Profilkép módosítása"
        >
          <input type="file" accept="image/*" onChange={uploadAvatar} style={{ display: 'none' }} />
          {profile.avatar_url ? (
            <img
              src={profile.avatar_url}
              alt=""
              style={{
                width: 88,
                height: 88,
                borderRadius: '50%',
                objectFit: 'cover',
                border: '3px solid var(--primary)',
              }}
            />
          ) : (
            <div
              style={{
                width: 88,
                height: 88,
                borderRadius: '50%',
                background: 'linear-gradient(135deg, #1e40af 0%, #3b82f6 100%)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                fontSize: 36,
                color: '#fff',
                fontWeight: 800,
              }}
            >
              {(profile.full_name || '?').charAt(0).toUpperCase()}
            </div>
          )}
          <div
            style={{
              position: 'absolute',
              bottom: 0,
              right: 0,
              width: 28,
              height: 28,
              borderRadius: '50%',
              background: '#fff',
              border: '2px solid var(--primary)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              fontSize: 14,
              boxShadow: '0 1px 4px rgba(0,0,0,0.2)',
            }}
          >
            📷
          </div>
        </label>
        <div>
          <h1 style={{ margin: 0, fontSize: 26 }}>{profile.full_name}</h1>
          <p className="muted" style={{ margin: '4px 0' }}>{profile.email}</p>
          <div style={{ display: 'flex', gap: 12, marginTop: 8 }}>
            {profile.rating_count > 0 ? (
              <span
                style={{
                  background: '#fef3c7',
                  padding: '4px 12px',
                  borderRadius: 999,
                  fontSize: 14,
                  fontWeight: 700,
                }}
              >
                ⭐ {Number(profile.rating_avg).toFixed(1)} ({profile.rating_count} értékelés)
              </span>
            ) : (
              <span className="muted" style={{ fontSize: 13 }}>Még nincs értékelés</span>
            )}
            <span className="muted" style={{ fontSize: 13 }}>
              Tag {memberSince} óta
            </span>
          </div>
        </div>
      </div>

      {!editing ? (
        <>
          {/* Megjelenítés mód */}
          <div className="card">
            <h2 style={{ marginTop: 0 }}>Személyes adatok</h2>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
              <div>
                <div className="muted" style={{ fontSize: 12 }}>Teljes név</div>
                <strong>{profile.full_name}</strong>
              </div>
              <div>
                <div className="muted" style={{ fontSize: 12 }}>Telefon</div>
                <strong>{profile.phone || '—'}</strong>
              </div>
              <div style={{ gridColumn: '1 / -1' }}>
                <div className="muted" style={{ fontSize: 12 }}>Bemutatkozás</div>
                <span>{profile.bio || '—'}</span>
              </div>
            </div>
          </div>

          <div className="card" style={{ marginTop: 16 }}>
            <h2 style={{ marginTop: 0 }}>🚛 Jármű (opcionális)</h2>
            <p className="muted" style={{ marginTop: 0 }}>
              Ha sofőrként is tevékenykedsz, add meg a járműved adatait.
              Nem kötelező — bármikor hozzáadhatod később.
            </p>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
              <div>
                <div className="muted" style={{ fontSize: 12 }}>Jármű típusa</div>
                <strong>{profile.vehicle_type || '—'}</strong>
              </div>
              <div>
                <div className="muted" style={{ fontSize: 12 }}>Rendszám</div>
                <strong>{profile.vehicle_plate || '—'}</strong>
              </div>
            </div>
          </div>

          <button
            className="btn"
            type="button"
            onClick={() => setEditing(true)}
            style={{ marginTop: 24 }}
          >
            ✏️ Profil szerkesztése
          </button>
        </>
      ) : (
        <>
          {/* Szerkesztés mód */}
          <div className="card">
            <h2 style={{ marginTop: 0 }}>Személyes adatok</h2>
            <div className="grid-2">
              <div>
                <label>Teljes név</label>
                <input
                  className="input"
                  value={fullName}
                  onChange={(e) => setFullName(e.target.value)}
                />
              </div>
              <div>
                <label>Telefon</label>
                <input
                  className="input"
                  value={phone}
                  onChange={(e) => setPhone(e.target.value)}
                  placeholder="+36 30 123 4567"
                />
              </div>
            </div>
            <label>Bemutatkozás</label>
            <textarea
              className="input"
              rows={3}
              value={bio}
              onChange={(e) => setBio(e.target.value)}
              placeholder="Pár szó magadról… (pl. 10 éves tapasztalat költöztetésben)"
            />
          </div>

          <div className="card" style={{ marginTop: 16 }}>
            <h2 style={{ marginTop: 0 }}>🚛 Jármű (opcionális)</h2>
            <div className="grid-2">
              <div>
                <label>Jármű típusa</label>
                <input
                  className="input"
                  value={vehicleType}
                  onChange={(e) => setVehicleType(e.target.value)}
                  placeholder="pl. Ford Transit, 3.5t"
                />
              </div>
              <div>
                <label>Rendszám</label>
                <input
                  className="input"
                  value={vehiclePlate}
                  onChange={(e) => setVehiclePlate(e.target.value)}
                  placeholder="pl. ABC-123"
                />
              </div>
            </div>
          </div>

          <div style={{ display: 'flex', gap: 12, marginTop: 24 }}>
            <button
              className="btn"
              type="button"
              onClick={save}
              disabled={saving}
            >
              {saving ? 'Mentés…' : '💾 Mentés'}
            </button>
            <button
              className="btn btn-secondary"
              type="button"
              onClick={() => setEditing(false)}
            >
              Mégse
            </button>
          </div>
        </>
      )}
    </div>
  );
}
