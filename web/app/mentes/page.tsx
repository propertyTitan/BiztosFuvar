'use client';

// =====================================================================
//  Autómentés kérése — a bajba jutott autós szemszöge.
//
//  EGY KÉPERNYŐS, nagy gombos, pánik-biztos flow:
//    1) GPS automatikus → "Itt állsz: [cím]"
//    2) Mi a baj? → nagy ikonos gombok (defekt, lerobbanás, stb.)
//    3) Milyen jármű? → autó / kisbusz / teherautó / motor
//    4) EGY GOMB → "MENTŐST KÉREK!" → push megy
//    5) Várakozás → "Keresünk mentőst a közelben…" → elfogadás
// =====================================================================

import { useEffect, useState } from 'react';
import { api } from '@/api';
import { useCurrentUser } from '@/lib/auth';
import { getSocket } from '@/lib/socket';

const ISSUES = [
  { id: 'flat_tire',  icon: '🛞', label: 'Defekt',        desc: 'Mobilgumis / kerékcsere' },
  { id: 'breakdown',  icon: '🔧', label: 'Lerobbanás',    desc: 'Motor, váltó, egyéb műszaki' },
  { id: 'battery',    icon: '🔋', label: 'Akkumulátor',   desc: 'Lemerült, begyújtás kell' },
  { id: 'ditch',      icon: '🏔️', label: 'Elakadás',      desc: 'Árok, sár, hó, megakadtam' },
  { id: 'accident',   icon: '💥', label: 'Baleset',       desc: 'Ütközés utáni mentés/szállítás' },
  { id: 'lockout',    icon: '🔑', label: 'Bezárt kulcs',  desc: 'Kulcs bent maradt az autóban' },
  { id: 'fuel',       icon: '⛽', label: 'Üzemanyag',     desc: 'Kifogyott a benzin/dízel' },
  { id: 'other',      icon: '❓', label: 'Egyéb',         desc: 'Más probléma' },
] as const;

const VEHICLES = [
  { id: 'car',        icon: '🚗', label: 'Személyautó' },
  { id: 'van',        icon: '🚐', label: 'Kisbusz / kisteherautó' },
  { id: 'truck',      icon: '🚛', label: 'Teherautó' },
  { id: 'motorcycle', icon: '🏍️', label: 'Motor' },
] as const;

type TowResponse = {
  responder_name: string;
  responder_phone?: string;
  responder_vehicle?: string;
  estimated_price_huf?: number;
};

export default function MentesKeres() {
  const me = useCurrentUser();
  const [step, setStep] = useState<'issue' | 'vehicle' | 'confirm' | 'searching' | 'found'>('issue');
  const [gpsStatus, setGpsStatus] = useState<'loading' | 'ok' | 'error'>('loading');
  const [lat, setLat] = useState<number | null>(null);
  const [lng, setLng] = useState<number | null>(null);
  const [address, setAddress] = useState('');
  const [issueType, setIssueType] = useState('');
  const [vehicleType, setVehicleType] = useState('car');
  const [description, setDescription] = useState('');
  const [plate, setPlate] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');
  const [towId, setTowId] = useState<string | null>(null);
  const [responder, setResponder] = useState<TowResponse | null>(null);

  // GPS kérés induláskor
  useEffect(() => {
    if (!navigator.geolocation) {
      setGpsStatus('error');
      return;
    }
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        setLat(pos.coords.latitude);
        setLng(pos.coords.longitude);
        setGpsStatus('ok');
      },
      () => setGpsStatus('error'),
      { enableHighAccuracy: true, timeout: 10000 },
    );
  }, []);

  // Realtime: ha mentős elfogadta
  useEffect(() => {
    if (!me) return;
    const socket = getSocket();
    const onAccepted = (data: any) => {
      setResponder({
        responder_name: data.responder_name,
        responder_phone: data.responder_phone,
        responder_vehicle: data.responder_vehicle,
        estimated_price_huf: data.estimated_price_huf,
      });
      setStep('found');
    };
    socket.on('towing:accepted', onAccepted);
    return () => { socket.off('towing:accepted', onAccepted); };
  }, [me?.id]);

  async function submitRequest() {
    if (!lat || !lng) {
      setError('GPS pozíció szükséges!');
      return;
    }
    setSubmitting(true);
    setError('');
    try {
      const res = await api.requestTowing({
        lat, lng, address,
        issue_type: issueType,
        issue_description: description || undefined,
        vehicle_type: vehicleType,
        vehicle_plate: plate || undefined,
      });
      setTowId(res.id);
      setStep('searching');
    } catch (err: any) {
      setError(err.message);
    } finally {
      setSubmitting(false);
    }
  }

  if (!me) {
    return (
      <div style={{ maxWidth: 600, margin: '0 auto', textAlign: 'center', padding: 40 }}>
        <div style={{ fontSize: 64, marginBottom: 16 }}>🚨</div>
        <h1>Autómentés</h1>
        <p>Jelentkezz be a mentés kéréséhez.</p>
        <a href="/bejelentkezes" className="btn" style={{ textDecoration: 'none' }}>
          Bejelentkezés
        </a>
      </div>
    );
  }

  return (
    <div style={{ maxWidth: 600, margin: '0 auto' }}>
      {/* GPS státusz */}
      <div style={{
        padding: '12px 16px', borderRadius: 8, marginBottom: 20,
        background: gpsStatus === 'ok' ? 'rgba(46,125,50,0.1)' : gpsStatus === 'error' ? 'rgba(239,68,68,0.1)' : 'rgba(255,255,255,0.05)',
        border: `1px solid ${gpsStatus === 'ok' ? '#2E7D32' : gpsStatus === 'error' ? '#EF4444' : 'var(--border)'}`,
      }}>
        {gpsStatus === 'loading' && '📍 GPS pozíció meghatározása…'}
        {gpsStatus === 'ok' && `📍 Pozíció rögzítve: ${lat!.toFixed(5)}, ${lng!.toFixed(5)}`}
        {gpsStatus === 'error' && '❌ Nem sikerült a GPS. Engedélyezd a helymeghatározást!'}
      </div>

      {/* STEP 1: Mi a baj? */}
      {step === 'issue' && (
        <>
          <h1 style={{ textAlign: 'center', marginBottom: 8 }}>🚨 Mi történt?</h1>
          <p className="muted" style={{ textAlign: 'center', marginBottom: 24 }}>
            Válaszd ki a problémát — az autómentős / mobilgumis ehhez készül fel.
          </p>
          <div style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fill, minmax(140px, 1fr))',
            gap: 12,
          }}>
            {ISSUES.map((issue) => (
              <button
                key={issue.id}
                type="button"
                onClick={() => { setIssueType(issue.id); setStep('vehicle'); }}
                style={{
                  padding: 16,
                  borderRadius: 12,
                  border: '2px solid var(--border)',
                  background: 'var(--surface)',
                  cursor: 'pointer',
                  textAlign: 'center',
                  transition: 'all 0.15s',
                  color: 'var(--text)',
                }}
              >
                <div style={{ fontSize: 36, marginBottom: 8 }}>{issue.icon}</div>
                <div style={{ fontWeight: 700, fontSize: 14 }}>{issue.label}</div>
                <div className="muted" style={{ fontSize: 11, marginTop: 4 }}>{issue.desc}</div>
              </button>
            ))}
          </div>
        </>
      )}

      {/* STEP 2: Milyen jármű? */}
      {step === 'vehicle' && (
        <>
          <h1 style={{ textAlign: 'center', marginBottom: 8 }}>
            {ISSUES.find((i) => i.id === issueType)?.icon} Milyen járművel?
          </h1>
          <p className="muted" style={{ textAlign: 'center', marginBottom: 24 }}>
            A mentős ez alapján tudja, milyen felszereléssel jöjjön.
          </p>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
            {VEHICLES.map((v) => (
              <button
                key={v.id}
                type="button"
                onClick={() => { setVehicleType(v.id); setStep('confirm'); }}
                style={{
                  padding: 20,
                  borderRadius: 12,
                  border: `2px solid ${vehicleType === v.id ? 'var(--primary)' : 'var(--border)'}`,
                  background: vehicleType === v.id ? 'rgba(59,130,246,0.1)' : 'var(--surface)',
                  cursor: 'pointer',
                  textAlign: 'center',
                  color: 'var(--text)',
                }}
              >
                <div style={{ fontSize: 40, marginBottom: 8 }}>{v.icon}</div>
                <div style={{ fontWeight: 700 }}>{v.label}</div>
              </button>
            ))}
          </div>
          <button
            className="btn btn-secondary"
            style={{ marginTop: 16, width: '100%' }}
            onClick={() => setStep('issue')}
          >
            ← Vissza
          </button>
        </>
      )}

      {/* STEP 3: Megerősítés + opcionális adatok */}
      {step === 'confirm' && (
        <>
          <h1 style={{ textAlign: 'center', marginBottom: 24 }}>Összefoglaló</h1>
          <div className="card" style={{ marginBottom: 16 }}>
            <div style={{ display: 'flex', gap: 16, alignItems: 'center', marginBottom: 12 }}>
              <span style={{ fontSize: 40 }}>{ISSUES.find((i) => i.id === issueType)?.icon}</span>
              <div>
                <strong style={{ fontSize: 18 }}>{ISSUES.find((i) => i.id === issueType)?.label}</strong>
                <div className="muted">{VEHICLES.find((v) => v.id === vehicleType)?.label}</div>
              </div>
            </div>
            <label style={{ fontSize: 13 }}>Rendszám (opcionális, segít a mentősnek)</label>
            <input
              className="input"
              value={plate}
              onChange={(e) => setPlate(e.target.value.toUpperCase())}
              placeholder="pl. ABC-123"
            />
            <label style={{ fontSize: 13, marginTop: 8 }}>Megjegyzés (opcionális)</label>
            <textarea
              className="input"
              rows={2}
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="pl. Az M1-es 42. km-nél állok a leállósávban"
            />
          </div>

          {error && <p style={{ color: '#EF4444', marginBottom: 12 }}>{error}</p>}

          <button
            className="btn"
            type="button"
            onClick={submitRequest}
            disabled={submitting || gpsStatus !== 'ok'}
            style={{
              width: '100%',
              padding: '16px 24px',
              fontSize: 18,
              fontWeight: 800,
              background: '#DC2626',
              letterSpacing: 0.5,
            }}
          >
            {submitting ? 'Küldés…' : '🚨 MENTŐST KÉREK!'}
          </button>
          <button
            className="btn btn-secondary"
            style={{ marginTop: 12, width: '100%' }}
            onClick={() => setStep('vehicle')}
          >
            ← Vissza
          </button>
        </>
      )}

      {/* STEP 4: Keresünk mentőst */}
      {step === 'searching' && (
        <div style={{ textAlign: 'center', padding: 40 }}>
          <div style={{ fontSize: 64, marginBottom: 16, animation: 'pulse 1.5s infinite' }}>🔍</div>
          <h1>Keresünk mentőst a közelben…</h1>
          <p className="muted">
            Push értesítés ment minden elérhető mentős-sofőrnek 30 km-en belül.
            Az első, aki elvállalja, elindul hozzád.
          </p>
          <div style={{
            marginTop: 24, padding: 16, borderRadius: 8,
            background: 'rgba(255,255,255,0.05)', border: '1px solid var(--border)',
          }}>
            <strong>{ISSUES.find((i) => i.id === issueType)?.icon} {ISSUES.find((i) => i.id === issueType)?.label}</strong>
            <span className="muted"> · {VEHICLES.find((v) => v.id === vehicleType)?.label}</span>
            {plate && <span className="muted"> · {plate}</span>}
          </div>
          <button
            className="btn btn-secondary"
            style={{ marginTop: 24 }}
            onClick={async () => {
              if (towId && confirm('Biztosan lemondod a mentés kérést?')) {
                try {
                  await api.cancelTowing(towId);
                  setStep('issue');
                  setTowId(null);
                } catch {}
              }
            }}
          >
            Mégsem / Lemondás
          </button>
          <style>{`@keyframes pulse { 0%,100% { opacity:1 } 50% { opacity:0.4 } }`}</style>
        </div>
      )}

      {/* STEP 5: Mentős elfogadta! */}
      {step === 'found' && responder && (
        <div style={{ textAlign: 'center', padding: 40 }}>
          <div style={{ fontSize: 64, marginBottom: 16 }}>🎉</div>
          <h1 style={{ color: '#2E7D32' }}>Mentős úton van!</h1>
          <div className="card" style={{ marginTop: 24, textAlign: 'left' }}>
            <div style={{ fontSize: 18, fontWeight: 700, marginBottom: 8 }}>
              {responder.responder_name}
            </div>
            {responder.responder_vehicle && (
              <p className="muted" style={{ margin: '4px 0' }}>
                🚗 {responder.responder_vehicle}
              </p>
            )}
            {responder.responder_phone && (
              <p style={{ margin: '4px 0' }}>
                📞 <a href={`tel:${responder.responder_phone}`} style={{ fontWeight: 700, fontSize: 18 }}>
                  {responder.responder_phone}
                </a>
              </p>
            )}
            {responder.estimated_price_huf && (
              <p style={{ margin: '8px 0 0' }}>
                💰 Becsült ár: <strong>{responder.estimated_price_huf.toLocaleString('hu-HU')} Ft</strong>
              </p>
            )}
          </div>
          <p className="muted" style={{ marginTop: 16 }}>
            Ha kérdésed van, hívd a mentőst közvetlenül a fenti telefonszámon.
          </p>
        </div>
      )}
    </div>
  );
}
