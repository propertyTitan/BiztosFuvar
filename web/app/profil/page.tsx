'use client';

// Profil oldal — a bejelentkezett user megnézheti és szerkesztheti a
// saját adatait: név, telefon, jármű (opcionális), bemutatkozás.
// Nincs "szállító vs feladó" választás — bárki egyformán hozzáfér mindkét
// funkcióhoz, a jármű adatok opcionálisak.
import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { api } from '@/api';
import { useCurrentUser, setCurrentUser , frissitCurrentUser } from '@/lib/auth';
import { useToast } from '@/components/ToastProvider';
import ConfirmDialog from '@/components/ConfirmDialog';
import { Loading, ErrorState } from '@/components/StateView';
import ReferralCard from '@/components/ReferralCard';
import TaxDataCard from '@/components/TaxDataCard';
import FieldError, { redBorder } from '@/components/FieldError';
import { nameError, optionalPhoneError, plateError, bioError } from '@/lib/formValidation';
import {
  Camera, Star, Truck, ShieldCheck, Trash2, Download, Save, CircleCheck, Hourglass, XCircle, FileUp,
} from 'lucide-react';

const API = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:4000';
function avatarSrc(url?: string) {
  if (!url) return '';
  if (url.startsWith('http') || url.startsWith('data:')) return url;
  return `${API}${url}`;
}

export default function ProfilOldal() {
  const router = useRouter();
  const me = useCurrentUser();
  const toast = useToast();
  const [profile, setProfile] = useState<any>(null);
  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState(false);
  // Mounted flag — az első renderen a useCurrentUser még null-t ad vissza,
  // mert a useEffect csak utána olvassa ki a localStorage-t. Ha a profil
  // oldal az első renderen rögtön redirect-elne, a belépett user is kidobna.
  // Ezért várunk 1 frame-et, és csak akkor döntünk.
  const [mounted, setMounted] = useState(false);
  useEffect(() => { setMounted(true); }, []);
  // Belépés-kapu (2026-09-11, C2): a redirect EFFEKTBEN, nem render közben
  // (React: render alatti navigáció figyelmeztetés + dupla push).
  useEffect(() => { if (mounted && !me) router.push('/bejelentkezes'); }, [mounted, me, router]);

  // Form state
  const [fullName, setFullName] = useState('');
  const [phone, setPhone] = useState('');
  const [vehicleType, setVehicleType] = useState('');
  const [vehiclePlate, setVehiclePlate] = useState('');
  const [bio, setBio] = useState('');

  const [loadError, setLoadError] = useState<string | null>(null);
  const [showDeleteDialog, setShowDeleteDialog] = useState(false);

  useEffect(() => {
    if (!me) return;
    const loadProfile = () => {
      api.getMyProfile().then((p) => {
        setProfile(p);
        setFullName(p.full_name || '');
        setPhone(p.phone || '');
        setVehicleType(p.vehicle_type || '');
        setVehiclePlate(p.vehicle_plate || '');
        setBio(p.bio || '');
      }).catch((e: any) => {
        // Hiba nélkül a "Betöltés…" örökre ott ragadna
        setLoadError(e.message || 'Nem sikerült betölteni a profilt.');
      });
    };
    loadProfile();
    // A KYC-modal sikeres feltöltése után a státusz-jelvények F5 nélkül
    // frissülnek (stale UI fix)
    window.addEventListener('gofuvar:kyc-updated', loadProfile);
    return () => window.removeEventListener('gofuvar:kyc-updated', loadProfile);
  }, [me]);

  // GF-012/015 (Manus, 2026-08-30): mezőszintű, ÉLŐ validáció — a hibás
  // mentés eddig csak toastban közölte az okot, és a kijavított mező hibája
  // nem tűnt el. A hibák minden renderben újraszámolódnak (javításkor
  // azonnal törlődnek), de csak mentés-próba után jelennek meg.
  const profilHibak = {
    fullName: nameError(fullName),
    phone: optionalPhoneError(phone),
    vehiclePlate: plateError(vehiclePlate),
    bio: bioError(bio),
  };
  const [mentesProba, setMentesProba] = useState(false);
  const profilHiba = (k: keyof typeof profilHibak) => (mentesProba ? profilHibak[k] : null);

  async function save() {
    setMentesProba(true);
    const elsoHibas = (Object.keys(profilHibak) as Array<keyof typeof profilHibak>)
      .find((k) => profilHibak[k] !== null);
    if (elsoHibas) {
      const mezoId: Record<string, string> = {
        fullName: 'profil-teljes-nev',
        phone: 'profil-telefon',
        vehiclePlate: 'profil-rendszam',
        bio: 'profil-bemutatkozas',
      };
      toast.error('Hibás mező', profilHibak[elsoHibas]!);
      const cel = document.getElementById(mezoId[elsoHibas]);
      if (cel) {
        cel.scrollIntoView({ behavior: 'smooth', block: 'center' });
        (cel as HTMLElement).focus({ preventScroll: true });
      }
      return;
    }
    setSaving(true);
    try {
      const updated = await api.updateMyProfile({
        full_name: fullName.trim(),
        phone: phone.trim(),
        vehicle_type: vehicleType.trim(),
        vehicle_plate: vehiclePlate.trim(),
        bio: bio.trim(),
      });
      // BUG-009: merge — a PATCH-válasz nem a teljes profil, sima
      // cserénél a KYC-jelvények "nincs feltöltve"-re estek vissza F5-ig
      setProfile((prev: any) => ({ ...prev, ...updated }));
      setEditing(false);
      // A fejléc (és minden useCurrentUser-fogyasztó) is az új nevet lássa
      // F5 nélkül (stale UI fix)
      const token = window.localStorage.getItem('gofuvar_token');
      if (token && me) {
        setCurrentUser({ ...me, full_name: updated.full_name }, token);
      }
      toast.success('Profil mentve');
    } catch (e: any) {
      toast.error('Hiba', e.message);
    } finally {
      setSaving(false);
    }
  }

  // Amíg nem mountoltunk le, vagy még olvassuk a localStorage-t, semleges
  // loading-state — NE redirect-eljünk, mert a useCurrentUser első renderen
  // mindig null-t ad vissza (a useEffect utánra halasztja az olvasást).
  if (!mounted) {
    return (
      <div style={{ padding: '32px 16px', textAlign: 'center', color: 'var(--muted)' }}>
        Betöltés…
      </div>
    );
  }
  if (!me) return null;
  async function uploadAvatar(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      toast.info('Profilkép feltöltése…');
      const { url } = await api.uploadAvatar(file);
      // A feltöltő végpont MAGA menti az avatar_url-t — külön PATCH nem kell.
      // (2026-08-10: az `avatar_url` szándékosan kikerült a szerkeszthető
      // profil-mezők közül; szabadon írható értékre nem szabad fájl-törlést
      // alapozni — lásd backend/src/routes/auth.js.)
      setProfile((prev: any) => ({ ...prev, avatar_url: url }));
      // ⚠️ A FEJLÉCET IS FRISSÍTENI KELL (2026-08-15, tesztelői észrevétel).
      // Eddig csak ez az oldal frissült; a jobb felső sarokban lévő kép nem
      // változott — se azonnal, se ki-/bejelentkezés után, mert a tárolt
      // user-objektum egyáltalán nem tartalmazott avatart. Ez az esemény
      // minden `useCurrentUser()` hookot újrarendel, újratöltés nélkül.
      frissitCurrentUser({ avatar_url: url });
      toast.success('Profilkép mentve!');
    } catch (err: any) {
      toast.error('Hiba', err.message);
    }
  }

  async function adataimLetoltese() {
    try {
      const adat = await api.exportMyData();
      const url = URL.createObjectURL(
        new Blob([JSON.stringify(adat, null, 2)], { type: 'application/json' }),
      );
      const a = document.createElement('a');
      a.href = url;
      a.download = `gofuvar-adataim-${new Date().toISOString().slice(0, 10)}.json`;
      a.click();
      URL.revokeObjectURL(url);
      toast.success('Az adataid letöltve');
    } catch (err: any) {
      toast.error('Hiba', err.message);
    }
  }

  if (loadError) return <ErrorState message={loadError} onRetry={() => window.location.reload()} />;
  if (!profile) return <Loading />;

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
          <input type="file" aria-label="Profilkép feltöltése" accept="image/*" onChange={uploadAvatar} style={{ display: 'none' }} />
          {profile.avatar_url ? (
            <img
              src={avatarSrc(profile.avatar_url)}
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
                background: 'linear-gradient(135deg, var(--primary) 0%, var(--primary-light) 100%)',
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
              background: 'var(--surface)',
              border: '2px solid var(--primary)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              fontSize: 14,
              boxShadow: '0 1px 4px rgba(0,0,0,0.2)',
            }}
          >
            <Camera size={14} aria-hidden />
          </div>
        </label>
        <div>
          <h1 style={{ margin: 0, fontSize: 24 }}>{profile.full_name}</h1>
          <p className="muted" style={{ margin: '4px 0' }}>{profile.email}</p>
          <div style={{ display: 'flex', gap: 12, marginTop: 8 }}>
            {profile.rating_count > 0 ? (
              <span
                style={{
                  background: 'var(--warning-light)',
                  padding: '4px 12px',
                  borderRadius: 999,
                  fontSize: 14,
                  fontWeight: 700,
                }}
              >
                <Star size={13} aria-hidden style={{ verticalAlign: -2 }} /> {Number(profile.rating_avg).toFixed(1)} ({profile.rating_count} értékelés)
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
            <h2 style={{ marginTop: 0 }}><Truck size={18} aria-hidden style={{ verticalAlign: -3 }} /> Jármű (opcionális)</h2>
            <p className="muted" style={{ marginTop: 0 }}>
              Ha szállítóként is tevékenykedsz, add meg a járműved adatait.
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

          {/* KYC státusz kártya */}
          <div className="card" style={{ marginTop: 16 }}>
            <h2 style={{ marginTop: 0 }}><ShieldCheck size={18} aria-hidden style={{ verticalAlign: -3 }} /> Azonosítás (KYC)</h2>
            <p className="muted" style={{ margin: '0 0 12px', fontSize: 13 }}>
              Fuvar-feladáshoz nem kell okmány — a személyazonosítás a
              szállító-módhoz (fuvarvállaláshoz) szükséges.
            </p>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              <KycStatusRow
                label="Személyi igazolvány (szállító-módhoz)"
                status={profile.identity_kyc_status}
                docType="id_card"
              />
              {/* Jogosítvány-feltöltés megszűnt (2026-07-07): a személyi
                  igazolvány igazolása elég mindenhez (feladó ÉS szállító).
                  A szállítói KRESZ-nyilatkozat a szállító-mód első használatakor. */}
            </div>
          </div>

          {/* DAC7 adóazonosító-bekérés — csak akkor látszik, ha a backend
              már kérte (első teljesített fuvar után) és még nincs megadva */}
          <TaxDataCard profile={profile} onSaved={() => {
            window.dispatchEvent(new Event('gofuvar:kyc-updated'));
          }} />

          <ReferralCard />

          <button
            className="btn"
            type="button"
            onClick={() => setEditing(true)}
            style={{ marginTop: 24 }}
          >
            Profil szerkesztése
          </button>

          {/* Fiók törlés */}
          <button
            type="button"
            onClick={() => setShowDeleteDialog(true)}
            style={{
              marginTop: 32,
              padding: '10px 20px',
              borderRadius: 8,
              border: '1px solid var(--danger)',
              background: 'transparent',
              color: 'var(--danger-text)',
              fontWeight: 600,
              fontSize: 13,
              cursor: 'pointer',
            }}
          >
            <Trash2 size={14} aria-hidden style={{ verticalAlign: -2 }} /> Fiók végleges törlése
          </button>

          {/* Adathordozhatóság (GDPR 20. cikk) — a végpont régóta megvolt,
              de a felületről nem lehetett elérni, így az érintett csak
              e-mailben tudta kérni, és kézzel kellett kiszolgálni. */}
          <button
            type="button"
            onClick={adataimLetoltese}
            style={{
              marginLeft: 12,
              padding: '10px 20px',
              borderRadius: 8,
              border: '1px solid var(--border)',
              background: 'transparent',
              color: 'var(--text)',
              fontWeight: 600,
              fontSize: 13,
              cursor: 'pointer',
            }}
          >
            <Download size={14} aria-hidden style={{ verticalAlign: -2 }} /> Adataim letöltése (JSON)
          </button>
        </>
      ) : (
        <>
          {/* Szerkesztés mód */}
          <div className="card">
            <h2 style={{ marginTop: 0 }}>Személyes adatok</h2>
            <div className="grid-2">
              <div>
                <label htmlFor="profil-teljes-nev">Teljes név</label>
                <input id="profil-teljes-nev"
                  className="input"
                  value={fullName}
              maxLength={100}
                  onChange={(e) => setFullName(e.target.value)}
                  aria-invalid={Boolean(profilHiba('fullName'))}
                  style={profilHiba('fullName') ? redBorder : undefined}
                />
                <FieldError>{profilHiba('fullName')}</FieldError>
              </div>
              <div>
                <label htmlFor="profil-telefon">Telefon <span className="muted" style={{ fontWeight: 400, fontSize: 12 }}>(szállítóként kötelező)</span></label>
                <input id="profil-telefon"
                  className="input"
                  value={phone}
                  onChange={(e) => setPhone(e.target.value)}
                  placeholder="+36 30 123 4567"
                  aria-invalid={Boolean(profilHiba('phone'))}
                  style={profilHiba('phone') ? redBorder : undefined}
                />
                <FieldError>{profilHiba('phone')}</FieldError>
              </div>
            </div>
            <label htmlFor="profil-bemutatkozas">Bemutatkozás</label>
            <textarea id="profil-bemutatkozas"
              className="input"
              rows={3}
              value={bio}
              onChange={(e) => setBio(e.target.value)}
              placeholder="Pár szó magadról… (pl. 10 éves tapasztalat költöztetésben)"
              aria-invalid={Boolean(profilHiba('bio'))}
              style={profilHiba('bio') ? redBorder : undefined}
            />
            <FieldError>{profilHiba('bio')}</FieldError>
          </div>

          <div className="card" style={{ marginTop: 16 }}>
            <h2 style={{ marginTop: 0 }}><Truck size={18} aria-hidden style={{ verticalAlign: -3 }} /> Jármű (opcionális)</h2>
            <div className="grid-2">
              <div>
                <label htmlFor="profil-jarmu-tipusa">Jármű típusa</label>
                <input id="profil-jarmu-tipusa"
                  className="input"
                  value={vehicleType}
                  onChange={(e) => setVehicleType(e.target.value)}
                  placeholder="pl. Ford Transit, 3.5t"
                />
              </div>
              <div>
                <label htmlFor="profil-rendszam">Rendszám</label>
                <input id="profil-rendszam"
                  className="input"
                  value={vehiclePlate}
                  onChange={(e) => setVehiclePlate(e.target.value)}
                  placeholder="pl. ABC-123"
                  aria-invalid={Boolean(profilHiba('vehiclePlate'))}
                  style={profilHiba('vehiclePlate') ? redBorder : undefined}
                />
                <FieldError>{profilHiba('vehiclePlate')}</FieldError>
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
              {saving ? 'Mentés…' : <><Save size={14} aria-hidden style={{ verticalAlign: -2 }} /> Mentés</>}
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

      {/* Fióktörlés-megerősítő dialógus (a korábbi dupla window.confirm kiváltása) */}
      <ConfirmDialog
        open={showDeleteDialog}
        title="Fiók végleges törlése"
        message={
          <>
            Ez a művelet <strong>visszavonhatatlan</strong> — minden adatod, fuvarod és értékelésed
            véglegesen törlődik. Ha biztos vagy benne, írd be a mezőbe: <strong>TÖRLÉS</strong>
          </>
        }
        confirmLabel="Fiók végleges törlése"
        danger
        fields={[{ key: 'confirm', label: 'Megerősítés', required: true, placeholder: 'TÖRLÉS' }]}
        onConfirm={async (v) => {
          if ((v.confirm || '').trim().toUpperCase() !== 'TÖRLÉS') {
            toast.error('Megerősítés szükséges', 'A törléshez írd be: TÖRLÉS');
            return;
          }
          setShowDeleteDialog(false);
          try {
            await api.deleteMyAccount();
            localStorage.removeItem('gofuvar_token');
            localStorage.removeItem('gofuvar_user');
            window.location.href = '/bejelentkezes';
          } catch (err: any) {
            toast.error('Törlés sikertelen', err.message);
          }
        }}
        onClose={() => setShowDeleteDialog(false)}
      />
    </div>
  );
}

function KycStatusRow({ label, status, docType }: { label: string; status?: string; docType: string }) {
  const isVerified = status === 'verified';
  const isPending = status === 'pending';
  const isRejected = status === 'rejected';
  const isNone = !status || status === 'none';

  return (
    <div
      style={{
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'center',
        padding: '10px 14px',
        borderRadius: 8,
        background: isVerified
          ? 'rgba(46,125,50,0.1)'
          : isRejected
            ? 'rgba(239,68,68,0.1)'
            : 'rgba(255,255,255,0.05)',
        border: `1px solid ${isVerified ? 'var(--success)' : isRejected ? 'var(--danger)' : 'var(--border)'}`,
      }}
    >
      <span style={{ fontSize: 14, fontWeight: 600 }}>{label}</span>
      {isVerified && (
        <span style={{ color: 'var(--success-text)', fontWeight: 700, fontSize: 13 }}><CircleCheck size={13} aria-hidden style={{ verticalAlign: -2 }} /> Elfogadva</span>
      )}
      {isPending && (
        <span style={{ color: 'var(--warning-text)', fontWeight: 700, fontSize: 13 }}><Hourglass size={13} aria-hidden style={{ verticalAlign: -2 }} /> Ellenőrzés alatt</span>
      )}
      {isRejected && (
        <button
          type="button"
          onClick={() => {
            window.dispatchEvent(new CustomEvent('gofuvar:kyc-required', {
              detail: { code: docType === 'id_card' ? 'IDENTITY_KYC_REQUIRED' : docType === 'drivers_license' ? 'DRIVER_KYC_REQUIRED' : 'COMPANY_KYC_REQUIRED' },
            }));
          }}
          style={{
            background: 'var(--danger-strong)',
            color: '#fff',
            border: 'none',
            borderRadius: 6,
            padding: '6px 14px',
            fontWeight: 700,
            fontSize: 13,
            cursor: 'pointer',
          }}
        >
          <XCircle size={13} aria-hidden style={{ verticalAlign: -2 }} /> Elutasítva — Újra feltöltöm
        </button>
      )}
      {isNone && (
        <button
          type="button"
          onClick={() => {
            window.dispatchEvent(new CustomEvent('gofuvar:kyc-required', {
              detail: { code: docType === 'id_card' ? 'IDENTITY_KYC_REQUIRED' : docType === 'drivers_license' ? 'DRIVER_KYC_REQUIRED' : 'COMPANY_KYC_REQUIRED' },
            }));
          }}
          style={{
            background: 'var(--primary)',
            color: '#fff',
            border: 'none',
            borderRadius: 6,
            padding: '6px 14px',
            fontWeight: 700,
            fontSize: 13,
            cursor: 'pointer',
          }}
        >
          <FileUp size={13} aria-hidden style={{ verticalAlign: -2 }} /> Feltöltöm most
        </button>
      )}
    </div>
  );
}
