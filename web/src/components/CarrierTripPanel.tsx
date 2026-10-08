'use client';

// Szállítói fuvar-végrehajtás a weben (app nélkül).
//
// Két lépés, mindkettő fotó-alapú — GPS NINCS (a háttér-GPS + közeledés-SMS
// egy későbbi natív-app fejlesztés lesz):
//
//   1. accepted    → "Felvétel igazolása": fotó feltöltés → in_progress
//   2. in_progress → "Kézbesítés igazolása": fotó + 6 jegyű átvételi kód → delivered
//
// A backend (routes/photos.js) a kind=pickup / kind=dropoff alapján váltja
// a státuszt; dropoff-nál a kódot is ellenőrzi. Sikeres kézbesítés után a
// fuvardíj készpénzben jár a szállítónak.
//
// Két entitást szolgál ki: licites FUVAR (entity='job', a fuvar 'accepted'
// állapotából indul) és fix áras FOGLALÁS (entity='booking', a foglalás
// 'confirmed' állapotából — BUG-041 fix).

import { useEffect, useRef, useState } from 'react';
import { Hourglass, Truck, Package, Phone, CircleHelp } from 'lucide-react';
import FieldError, { redBorder } from '@/components/FieldError';
import { api } from '@/api';
import { useToast } from './ToastProvider';

/**
 * A kézbesítés szerver-oldali elutasításának felhasználói szövege (UX-review
 * Q15, 2026-10-08). A hibás kódra eddig „Sikertelen kézbesítés” volt a toast
 * címe — ez a visszaszállítási nyilatkozatban MÁST jelent (a címzett nem
 * veszi át a csomagot), a kapuban álló szállító pedig nem tudta, mi a dolga.
 * A backend üzenete („Érvénytelen átvételi kód (még N próbálkozás)”) alapján
 * megmondjuk, mi a teendő, és hány próbálkozás maradt.
 */
export function kezbesitesiHiba(uzenet: string): { cim: string; szoveg: string; kodGond: boolean } {
  const u = String(uzenet || '');
  const maradt = /még\s+(\d+)\s+próbálkozás/i.exec(u);
  if (maradt) {
    return {
      cim: 'Hibás átvételi kód',
      szoveg: `Kérd el újra az átvevőtől. Még ${maradt[1]} próbálkozásod van.`,
      kodGond: true,
    };
  }
  if (/zárolva/i.test(u)) return { cim: 'A kód-ellenőrzés zárolva', szoveg: u, kodGond: true };
  if (/átvételi kód/i.test(u)) {
    return { cim: 'Hibás átvételi kód', szoveg: 'Kérd el újra az aktuális kódot az átvevőtől.', kodGond: true };
  }
  return { cim: 'Nem sikerült igazolni a kézbesítést', szoveg: u, kodGond: false };
}

/** A visszaszállítási vállalás szövege (az ajánlatkori nyilatkozat szerint). */
function vallalasSzoveg(v: Vallalas | null | undefined): string | null {
  if (!v?.return_policy) return null;
  if (v.return_policy === 'included') return 'ha a címzett nem veszi át, 5 munkanapon belül visszajuttatod a csomagot a feladóhoz (benne van az ajánlatodban).';
  if (v.return_policy === 'extra_fee') {
    return `ha a címzett nem veszi át, 5 munkanapon belül visszajuttatod a csomagot a feladóhoz, külön díjért (${(v.return_fee_huf ?? 0).toLocaleString('hu-HU')} Ft).`;
  }
  return 'nem vállaltad a visszaszállítást — egyeztess a feladóval, mi legyen a csomaggal.';
}

type Vallalas = { return_policy?: 'included' | 'extra_fee' | 'no' | null; return_fee_huf?: number | null };

/** 64 px-es bélyegkép a kiválasztott fotóról, „Másik fotó” gombbal. */
function FotoElonezet({ file, inputId, alt }: { file: File; inputId: string; alt: string }) {
  const [url, setUrl] = useState<string | null>(null);
  const [hiba, setHiba] = useState(false);
  useEffect(() => {
    setHiba(false);
    if (typeof URL === 'undefined' || typeof URL.createObjectURL !== 'function') { setUrl(null); return; }
    const u = URL.createObjectURL(file);
    setUrl(u);
    return () => { URL.revokeObjectURL?.(u); };
  }, [file]);
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginTop: 10, flexWrap: 'wrap' }}>
      {url && !hiba ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={url}
          alt={alt}
          onError={() => setHiba(true)}
          style={{ width: 64, height: 64, objectFit: 'cover', borderRadius: 8, border: '1px solid var(--border)', background: 'var(--bg)' }}
        />
      ) : (
        <span style={{ fontSize: 13 }}>Kiválasztva: <strong>{file.name}</strong></span>
      )}
      <label htmlFor={inputId} className="btn btn-secondary" style={{ cursor: 'pointer', margin: 0 }}>
        Másik fotó
      </label>
    </div>
  );
}

type Props = {
  jobId: string;
  status: string;
  statusBeforeDispute?: string | null;
  /** Kifizette-e már a feladó (paid_at). Fizetetlen fuvaron a backend
   *  úgysem enged pickup/dropoff fotót — itt előre jelezzük a szállítónak. */
  paid: boolean;
  onDone: () => void; // a szülő újratölti a fuvart a státuszváltás után
  /** 'job' (alap) vagy 'booking' — melyik backend-végpontra töltsön. */
  entity?: 'job' | 'booking';
  /** Egyedi input-id prefix, ha egy oldalon több panel is megjelenik
   *  (pl. a szállító útvonal-oldalán foglalásonként egy). */
  idPrefix?: string;
  /** A feladó telefonszáma (a díj után jár) — az átadási elakadásnál hívható. */
  feladoTelefon?: string | null;
  /** A címzett telefonszáma (a díj után jár), ha más veszi át. */
  cimzettTelefon?: string | null;
  /** A szállító ajánlatkori visszaszállítási nyilatkozata. */
  vallalas?: Vallalas | null;
  /** Hová visz a „Probléma bejelentése” (pl. '#problema-bejelentese'). */
  problemaHref?: string;
};

export default function CarrierTripPanel({
  jobId, status, statusBeforeDispute, paid, onDone, entity = 'job', idPrefix = '',
  feladoTelefon, cimzettTelefon, vallalas, problemaHref,
}: Props) {
  const toast = useToast();
  const pickupInputRef = useRef<HTMLInputElement>(null);
  const dropoffInputRef = useRef<HTMLInputElement>(null);
  const kodInputRef = useRef<HTMLInputElement>(null);
  const [pickupFile, setPickupFile] = useState<File | null>(null);
  const [dropoffFile, setDropoffFile] = useState<File | null>(null);
  const [deliveryCode, setDeliveryCode] = useState('');
  const [busy, setBusy] = useState(false);
  // Mezőszintű hibajelzés (2026-08-16, tesztelői kérés): eddig CSAK egy
  // eltűnő toast szólt — a felhasználó nem látta, MELYIK mezőnél és MIT kell
  // tennie. Ugyanaz a piros keret + magyarázat, mint a többi űrlapon.
  const [pickupHiba, setPickupHiba] = useState<string | null>(null);
  const [dropoffFotoHiba, setDropoffFotoHiba] = useState<string | null>(null);
  const [kodHiba, setKodHiba] = useState<string | null>(null);

  async function submitPickup() {
    if (busy) return;
    if (!pickupFile) {
      setPickupHiba('Készíts egy fotót az átvett csomagról — enélkül a felvétel nem igazolható.');
      toast.error('Még hiányzik a fotó', 'A felvétel igazolásához fotó kell a csomagról — a gombbal tudod elkészíteni vagy kiválasztani.');
      return;
    }
    setPickupHiba(null);
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
    const code = deliveryCode.trim();
    // MINDKÉT hibát egyszerre jelezzük, nem egyenként — a felhasználó egy
    // körben lássa az összes teendőt.
    const fotoGond = !dropoffFile
      ? 'Készíts egy fotót az átadott csomagról — enélkül a kézbesítés nem igazolható.'
      : null;
    const kodGond = code.length !== 6 || !/^\d{6}$/.test(code)
      ? (code.length === 0
        ? 'Írd be a 6 számjegyű átvételi kódot — az átvevő (a címzett vagy a feladó) tudja megmondani.'
        : `Az átvételi kód pontosan 6 számjegy — most ${code.length} számjegyet írtál be.`)
      : null;
    setDropoffFotoHiba(fotoGond);
    setKodHiba(kodGond);
    if (fotoGond || kodGond) {
      toast.error('Nézd át a mezőket', 'A hiányzó lépések pirossal jelölve — alattuk a teendő.');
      return;
    }
    // Típus-szűkítés a TS-nek — a fenti ellenőrzés már garantálja.
    if (!dropoffFile) return;
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
      toast.success('Csomag kézbesítve', status === 'disputed'
        ? 'Az átadás igazolva. A vita továbbra is nyitva marad az ügyfélszolgálat döntéséig.'
        : 'A fuvar lezárult. Köszönjük!');
      onDone();
    } catch (e: any) {
      // ⚠️ GF-FT-02 (Manus, 2026-08-21): a szerver-oldali elutasítás (rossz
      // kód, zárolás) eddig CSAK toastban szólt, ami pár másodperc után
      // eltűnt — a szállító a kapuban állva nem tudta, rossz kódot írt-e,
      // vagy a hálózat halt el. A hiba mostantól TARTÓSAN a kód-mező alatt
      // marad, és a mező fókuszt kap az azonnali javításhoz.
      const h = kezbesitesiHiba(e.message);
      setKodHiba(h.kodGond ? h.szoveg : e.message);
      kodInputRef.current?.focus();
      toast.error(h.cim, h.szoveg);
    } finally {
      setBusy(false);
    }
  }

  // A foglalás 'confirmed' állapota felel meg a fuvar 'accepted'-jének —
  // egységesítjük, hogy a lenti elágazások mindkét entitásra jók legyenek.
  const physicalStatus = status === 'disputed' ? statusBeforeDispute : status;
  const stage = entity === 'booking' && physicalStatus === 'confirmed' ? 'accepted' : physicalStatus;

  // ---- fizetetlen fuvar: a munka még nem indulhat ----
  if ((stage === 'accepted' || stage === 'in_progress') && !paid) {
    return (
      <div className="card" style={{ marginTop: 16, borderColor: 'var(--warning, #d97706)' }}>
        <h2 style={{ marginTop: 0, display: 'flex', alignItems: 'center', gap: 8 }}>
          <Hourglass size={20} aria-hidden /> A feladó díjfizetésére várunk
        </h2>
        <p className="muted" style={{ marginTop: 0, fontSize: 14, lineHeight: 1.5 }}>
          A feladó még nem fizette meg a kapcsolatfelvételi díjat. A csomagot
          csak a díj beérkezése után vedd át — addig a felvétel igazolása nem
          elérhető. Amint a fizetés megtörténik, ez az oldal automatikusan
          frissül. A fuvardíjat közvetlenül a feladótól kapod — készpénzben vagy átutalással, ahogy megegyeztetek.
        </p>
        <p className="muted" style={{ fontSize: 14, lineHeight: 1.5, marginBottom: 0 }}>
          A pontos címet és a feladó telefonszámát a díj után látod.
        </p>
        {/* A lejáratás valós szabálya (services/paymentReminders.js): két
            emlékeztető után a fizetetlen megállapodás lezárul, mindkét fél
            értesítést kap. Csak a fuvar-ágon fut (a foglaláson nincs ilyen kör). */}
        {entity === 'job' && (
          <p className="muted" style={{ fontSize: 14, lineHeight: 1.5, marginBottom: 0 }}>
            A feladót kétszer emlékeztetjük. Ha ezután sem fizet, a fuvar néhány napon belül
            automatikusan lezárul, és értesítünk — addig nyugodtan vállalhatsz mást is.
          </p>
        )}
      </div>
    );
  }

  // ---- accepted: felvétel ----
  if (stage === 'accepted') {
    return (
      <div className="card" style={{ marginTop: 16, borderColor: 'var(--primary)' }}>
        <h2 style={{ marginTop: 0, display: 'flex', alignItems: 'center', gap: 8 }}>
          <Truck size={20} aria-hidden /> Fuvar indítása
        </h2>
        <p className="muted" style={{ marginTop: 0, fontSize: 14, lineHeight: 1.5 }}>
          Amikor átvetted a csomagot a feladótól, készíts róla egy fotót —
          ezzel indul el a fuvar. A fotó bizonyíték a csomag állapotáról.
        </p>
        {/* UX A01 (2026-10-08): a feladó a kódkártyán azt olvassa, hogy a
            kódot csak a csomag átadásakor mondja meg — a szállító ne kérje
            a felvételkor. */}
        <p className="muted" style={{ marginTop: 0, fontSize: 14, lineHeight: 1.5 }}>
          Az átvételi kódot most ne kérd: azt az átadáskor kapod meg.
        </p>

        {!pickupFile && (
          <label
            htmlFor={`${idPrefix}pickup-photo`}
            className="btn btn-secondary"
            style={{
              display: 'inline-block', cursor: 'pointer', marginTop: 4,
              ...(pickupHiba ? redBorder : {}),
            }}
          >
            Fotó kiválasztása / készítése
          </label>
        )}
        <FieldError>{pickupHiba}</FieldError>
        <input
          id={`${idPrefix}pickup-photo`}
          ref={pickupInputRef}
          type="file"
          accept="image/*"
          capture="environment"
          onChange={(e) => { setPickupFile(e.target.files?.[0] || null); setPickupHiba(null); }}
          // ⚠️ NEM display:none (2026-08-21): az kivenné a fókusz-sorrendből —
          // billentyűzettel (és egyes automatizált eszközökkel) elérhetetlen
          // volt a fotó-feltöltés. Látványra rejtett, de fókuszálható: Tab-bal
          // ráállva az Enter nyitja a fájlválasztót/kamerát.
          style={{
            position: 'absolute', width: 1, height: 1, opacity: 0,
            overflow: 'hidden', clipPath: 'inset(50%)',
          }}
        />

        {pickupFile && (
          <FotoElonezet file={pickupFile} inputId={`${idPrefix}pickup-photo`} alt="A felvételi fotó előnézete" />
        )}

        <div>
          <button
            type="button"
            className="btn"
            onClick={submitPickup}
            disabled={busy}
            aria-busy={busy}
            style={{ marginTop: 12 }}
          >
            {/* Feltöltés közben spinner is (Manus, 2026-08-22): a puszta
                szöveg-csere nem volt elég feltűnő, a felhasználó újra
                kattinthatott volna. */}
            {busy ? (
              <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
                <span aria-hidden style={{
                  width: 14, height: 14, borderRadius: '50%',
                  border: '2px solid rgba(255,255,255,0.4)', borderTopColor: '#fff',
                  animation: 'gofuvar-spin 0.8s linear infinite', display: 'inline-block',
                }} />
                Feltöltés…
              </span>
            ) : 'Felvétel igazolása → fuvar indítása'}
          </button>
        </div>
      </div>
    );
  }

  // ---- in_progress: kézbesítés ----
  if (stage === 'in_progress') {
    return (
      <div className="card" style={{ marginTop: 16, borderColor: 'var(--primary)' }}>
        <h2 style={{ marginTop: 0, display: 'flex', alignItems: 'center', gap: 8 }}>
          <Package size={20} aria-hidden /> Kézbesítés igazolása
        </h2>
        <p className="muted" style={{ marginTop: 0, fontSize: 14, lineHeight: 1.5 }}>
          A célállomáson készíts egy fotót az átadott csomagról, és kérd el az
          átvevőtől a <strong>6 számjegyű átvételi kódot</strong>. A kód beírásával
          zárul le a fuvar.
        </p>

        {!dropoffFile && (
          <label
            htmlFor={`${idPrefix}dropoff-photo`}
            className="btn btn-secondary"
            style={{
              display: 'inline-block', cursor: 'pointer', marginTop: 4,
              ...(dropoffFotoHiba ? redBorder : {}),
            }}
          >
            Fotó kiválasztása / készítése
          </label>
        )}
        <FieldError>{dropoffFotoHiba}</FieldError>
        <input
          id={`${idPrefix}dropoff-photo`}
          ref={dropoffInputRef}
          type="file"
          accept="image/*"
          capture="environment"
          onChange={(e) => { setDropoffFile(e.target.files?.[0] || null); setDropoffFotoHiba(null); }}
          // ⚠️ NEM display:none (2026-08-21): az kivenné a fókusz-sorrendből —
          // billentyűzettel (és egyes automatizált eszközökkel) elérhetetlen
          // volt a fotó-feltöltés. Látványra rejtett, de fókuszálható: Tab-bal
          // ráállva az Enter nyitja a fájlválasztót/kamerát.
          style={{
            position: 'absolute', width: 1, height: 1, opacity: 0,
            overflow: 'hidden', clipPath: 'inset(50%)',
          }}
        />

        {dropoffFile && (
          <FotoElonezet file={dropoffFile} inputId={`${idPrefix}dropoff-photo`} alt="A kézbesítési fotó előnézete" />
        )}

        <div style={{ marginTop: 12, maxWidth: 220 }}>
          <label htmlFor={`${idPrefix}atveteli-kod`} style={{ fontSize: 13, fontWeight: 600 }}>Átvételi kód (6 számjegy)</label>
          <input
            ref={kodInputRef}
            id={`${idPrefix}atveteli-kod`}
            className="input"
            inputMode="numeric"
            pattern="\d*"
            maxLength={6}
            value={deliveryCode}
            onChange={(e) => { setDeliveryCode(e.target.value.replace(/\D/g, '').slice(0, 6)); setKodHiba(null); }}
            // ⚠️ NEM "••••••" (2026-08-21, Manus-teszt): a hat pötty
            // placeholder-ként pont úgy nézett ki, mint egy KITÖLTÖTT
            // jelszó-mező — az ÜRES mezőt kitöltöttnek lehetett hinni, és a
            // lezárás "érthetetlenül" elutasította. A placeholder mondja meg,
            // MIT kell ide írni, ne imitáljon beírt titkot.
            placeholder="6 számjegy"
            title="A 6 számjegyű kódot az átvevő mondja meg — SMS-ben kapta a felvételkor."
            style={{
              letterSpacing: 4, fontSize: 18, textAlign: 'center',
              ...(kodHiba ? redBorder : {}),
            }}
          />
          <FieldError>{kodHiba}</FieldError>
        </div>
        <p className="muted" style={{ fontSize: 13, margin: '8px 0 0', lineHeight: 1.5 }}>
          Nincs kódja az átvevőnek? A feladónak is van érvényes átvételi kódja — hívd fel, és kérd el tőle.
        </p>
        {feladoTelefon && (
          <a
            href={`tel:${feladoTelefon}`}
            className="btn btn-secondary"
            style={{ marginTop: 8, display: 'inline-flex', alignItems: 'center', gap: 6, textDecoration: 'none' }}
          >
            <Phone size={14} aria-hidden /> Feladó hívása
          </a>
        )}

        <div>
          <button
            type="button"
            className="btn"
            onClick={submitDropoff}
            disabled={busy}
            aria-busy={busy}
            style={{ marginTop: 12 }}
          >
            {busy ? (
              <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
                <span aria-hidden style={{
                  width: 14, height: 14, borderRadius: '50%',
                  border: '2px solid rgba(255,255,255,0.4)', borderTopColor: '#fff',
                  animation: 'gofuvar-spin 0.8s linear infinite', display: 'inline-block',
                }} />
                Feltöltés…
              </span>
            ) : 'Kézbesítés igazolása → fuvar lezárása'}
          </button>
        </div>

        {/* Elakadt átadás (UX-review Q15): a címzett ajtajában, időnyomás
            alatt kell egy kiút — különben vita lesz belőle. */}
        <details style={{ marginTop: 16, borderTop: '1px solid var(--border)', paddingTop: 12 }}>
          <summary style={{ cursor: 'pointer', fontWeight: 600, fontSize: 14, display: 'flex', alignItems: 'center', gap: 6 }}>
            <CircleHelp size={16} aria-hidden /> Nem sikerül átadni?
          </summary>
          <ul style={{ margin: '10px 0 0', paddingLeft: 18, fontSize: 14, lineHeight: 1.6 }}>
            <li>
              Hívd fel az átvevőt
              {cimzettTelefon && <> (<a href={`tel:${cimzettTelefon}`}>{cimzettTelefon}</a>)</>}
              {' '}vagy a feladót{feladoTelefon && <> (<a href={`tel:${feladoTelefon}`}>{feladoTelefon}</a>)</>}.
            </li>
            {vallalasSzoveg(vallalas) && (
              <li>A vállalásod: {vallalasSzoveg(vallalas)}</li>
            )}
            {problemaHref && (
              <li>
                Ha nem jutottok dűlőre: <a href={problemaHref}>Probléma bejelentése</a>
              </li>
            )}
          </ul>
        </details>
      </div>
    );
  }

  return null;
}
