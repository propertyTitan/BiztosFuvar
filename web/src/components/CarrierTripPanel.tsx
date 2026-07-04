'use client';

// Sofőri fuvar-végrehajtás a weben (app nélkül).
//
// Két lépés, mindkettő fotó-alapú — GPS NINCS (a háttér-GPS + közeledés-SMS
// egy későbbi natív-app fejlesztés lesz):
//
//   1. accepted    → "Felvétel igazolása": fotó feltöltés → in_progress
//   2. in_progress → "Kézbesítés igazolása": fotó + 6 jegyű átvételi kód → delivered
//
// A backend (routes/photos.js) a kind=pickup / kind=dropoff alapján váltja
// a státuszt; dropoff-nál a kódot is ellenőrzi. Sikeres kézbesítés után a
// fuvardíj készpénzben jár a sofőrnek.
//
// Két entitást szolgál ki: licites FUVAR (entity='job', a fuvar 'accepted'
// állapotából indul) és fix áras FOGLALÁS (entity='booking', a foglalás
// 'confirmed' állapotából — BUG-041 fix).

import { useRef, useState } from 'react';
import { api } from '@/api';
import { useToast } from './ToastProvider';

type Props = {
  jobId: string;
  status: string;
  /** Kifizette-e már a feladó (paid_at). Fizetetlen fuvaron a backend
   *  úgysem enged pickup/dropoff fotót — itt előre jelezzük a sofőrnek. */
  paid: boolean;
  onDone: () => void; // a szülő újratölti a fuvart a státuszváltás után
  /** 'job' (alap) vagy 'booking' — melyik backend-végpontra töltsön. */
  entity?: 'job' | 'booking';
  /** Egyedi input-id prefix, ha egy oldalon több panel is megjelenik
   *  (pl. a sofőr útvonal-oldalán foglalásonként egy). */
  idPrefix?: string;
};

export default function CarrierTripPanel({ jobId, status, paid, onDone, entity = 'job', idPrefix = '' }: Props) {
  const toast = useToast();
  const pickupInputRef = useRef<HTMLInputElement>(null);
  const dropoffInputRef = useRef<HTMLInputElement>(null);
  const [pickupFile, setPickupFile] = useState<File | null>(null);
  const [dropoffFile, setDropoffFile] = useState<File | null>(null);
  const [deliveryCode, setDeliveryCode] = useState('');
  const [busy, setBusy] = useState(false);

  async function submitPickup() {
    if (busy) return;
    if (!pickupFile) {
      toast.error('Hiányzó fotó', 'Előbb válassz vagy készíts egy fotót a csomagról.');
      return;
    }
    setBusy(true);
    try {
      if (entity === 'booking') {
        await api.uploadBookingPhoto(jobId, pickupFile, 'pickup');
      } else {
        await api.uploadJobPhoto(jobId, pickupFile, 'pickup');
      }
      setPickupFile(null);
      if (pickupInputRef.current) pickupInputRef.current.value = '';
      toast.success('Fuvar elindítva', 'A felvételi fotó rögzítve, a fuvar folyamatban.');
      onDone();
    } catch (e: any) {
      toast.error('Hiba', e.message);
    } finally {
      setBusy(false);
    }
  }

  async function submitDropoff() {
    if (busy) return;
    if (!dropoffFile) {
      toast.error('Hiányzó fotó', 'Előbb válassz vagy készíts egy fotót az átadott csomagról.');
      return;
    }
    const code = deliveryCode.trim();
    if (code.length !== 6 || !/^\d{6}$/.test(code)) {
      toast.error('Hibás kód', 'Az átvételi kód pontosan 6 számjegy.');
      return;
    }
    setBusy(true);
    try {
      if (entity === 'booking') {
        await api.uploadBookingPhoto(jobId, dropoffFile, 'dropoff', { deliveryCode: code });
      } else {
        await api.uploadJobPhoto(jobId, dropoffFile, 'dropoff', { deliveryCode: code });
      }
      setDropoffFile(null);
      setDeliveryCode('');
      if (dropoffInputRef.current) dropoffInputRef.current.value = '';
      toast.success('Csomag kézbesítve', 'A fuvar lezárult. Köszönjük!');
      onDone();
    } catch (e: any) {
      toast.error('Sikertelen kézbesítés', e.message);
    } finally {
      setBusy(false);
    }
  }

  // A foglalás 'confirmed' állapota felel meg a fuvar 'accepted'-jének —
  // egységesítjük, hogy a lenti elágazások mindkét entitásra jók legyenek.
  const stage = entity === 'booking' && status === 'confirmed' ? 'accepted' : status;

  // ---- fizetetlen fuvar: a munka még nem indulhat ----
  if ((stage === 'accepted' || stage === 'in_progress') && !paid) {
    return (
      <div className="card" style={{ marginTop: 16, borderColor: 'var(--warning, #d97706)' }}>
        <h2 style={{ marginTop: 0 }}>⏳ Fizetésre vár</h2>
        <p className="muted" style={{ marginTop: 0, fontSize: 14, lineHeight: 1.5 }}>
          A feladó még nem fizette meg a kapcsolatfelvételi díjat. A csomagot
          csak a díj beérkezése után vedd át — addig a felvétel igazolása nem
          elérhető. Amint a fizetés megtörténik, ez az oldal automatikusan
          frissül. A fuvardíjat készpénzben kapod a feladótól.
        </p>
      </div>
    );
  }

  // ---- accepted: felvétel ----
  if (stage === 'accepted') {
    return (
      <div className="card" style={{ marginTop: 16, borderColor: 'var(--primary)' }}>
        <h2 style={{ marginTop: 0 }}>🚚 Fuvar indítása</h2>
        <p className="muted" style={{ marginTop: 0, fontSize: 14, lineHeight: 1.5 }}>
          Amikor átvetted a csomagot a feladótól, készíts róla egy fotót —
          ezzel indul el a fuvar. A fotó bizonyíték a csomag állapotáról.
        </p>

        <label
          htmlFor={`${idPrefix}pickup-photo`}
          className="btn btn-secondary"
          style={{ display: 'inline-block', cursor: 'pointer', marginTop: 4 }}
        >
          Fotó kiválasztása / készítése
        </label>
        <input
          id={`${idPrefix}pickup-photo`}
          ref={pickupInputRef}
          type="file"
          accept="image/*"
          capture="environment"
          onChange={(e) => setPickupFile(e.target.files?.[0] || null)}
          style={{ display: 'none' }}
        />

        {pickupFile && (
          <p style={{ fontSize: 13, margin: '10px 0 0' }}>
            ✅ Kiválasztva: <strong>{pickupFile.name}</strong>
          </p>
        )}

        <div>
          <button
            type="button"
            className="btn"
            onClick={submitPickup}
            disabled={busy}
            style={{ marginTop: 12 }}
          >
            {busy ? 'Feltöltés…' : 'Felvétel igazolása → fuvar indítása'}
          </button>
        </div>
      </div>
    );
  }

  // ---- in_progress: kézbesítés ----
  if (stage === 'in_progress') {
    return (
      <div className="card" style={{ marginTop: 16, borderColor: 'var(--primary)' }}>
        <h2 style={{ marginTop: 0 }}>📦 Kézbesítés igazolása</h2>
        <p className="muted" style={{ marginTop: 0, fontSize: 14, lineHeight: 1.5 }}>
          A célállomáson készíts egy fotót az átadott csomagról, és kérd el az
          átvevőtől a <strong>6 számjegyű átvételi kódot</strong>. A kód beírásával
          zárul le a fuvar.
        </p>

        <label
          htmlFor={`${idPrefix}dropoff-photo`}
          className="btn btn-secondary"
          style={{ display: 'inline-block', cursor: 'pointer', marginTop: 4 }}
        >
          Fotó kiválasztása / készítése
        </label>
        <input
          id={`${idPrefix}dropoff-photo`}
          ref={dropoffInputRef}
          type="file"
          accept="image/*"
          capture="environment"
          onChange={(e) => setDropoffFile(e.target.files?.[0] || null)}
          style={{ display: 'none' }}
        />

        {dropoffFile && (
          <p style={{ fontSize: 13, margin: '10px 0 0' }}>
            ✅ Kiválasztva: <strong>{dropoffFile.name}</strong>
          </p>
        )}

        <div style={{ marginTop: 12, maxWidth: 220 }}>
          <label style={{ fontSize: 13, fontWeight: 600 }}>Átvételi kód (6 számjegy)</label>
          <input
            className="input"
            inputMode="numeric"
            pattern="\d*"
            maxLength={6}
            value={deliveryCode}
            onChange={(e) => setDeliveryCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
            placeholder="••••••"
            style={{ letterSpacing: 4, fontSize: 18, textAlign: 'center' }}
          />
        </div>

        <div>
          <button
            type="button"
            className="btn"
            onClick={submitDropoff}
            disabled={busy}
            style={{ marginTop: 12 }}
          >
            {busy ? 'Feltöltés…' : 'Kézbesítés igazolása → fuvar lezárása'}
          </button>
        </div>
      </div>
    );
  }

  return null;
}
