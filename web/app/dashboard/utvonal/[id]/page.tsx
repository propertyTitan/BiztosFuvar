'use client';

// Feladó: egy konkrét szállítói útvonal részletei + foglalás form.
// - Az útvonal, árak, időpont
// - Foglalás form: csomag méretei + súly + pickup/dropoff cím autocomplete
// - Automatikus méret-besorolás
// - "Helyet foglalok" gomb → beállítja a státuszt pending-re (szállítóra vár)
import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import { api, CarrierRoute } from '@/api';
import { PACKAGE_SIZES, classifyPackage } from '@/lib/packageSizes';
import { useCurrentUser } from '@/lib/auth';
import AddressAutocomplete from '@/components/AddressAutocomplete';

export default function FeladoUtvonalReszletek() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const me = useCurrentUser();
  const [route, setRoute] = useState<CarrierRoute | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const [length, setLength] = useState('');
  const [width, setWidth] = useState('');
  const [height, setHeight] = useState('');
  const [weight, setWeight] = useState('');

  const [pickupAddr, setPickupAddr] = useState('');
  const [pickupLat, setPickupLat] = useState<number | null>(null);
  const [pickupLng, setPickupLng] = useState<number | null>(null);
  const [pickupConfirmed, setPickupConfirmed] = useState(false);

  const [dropoffAddr, setDropoffAddr] = useState('');
  const [dropoffLat, setDropoffLat] = useState<number | null>(null);
  const [dropoffLng, setDropoffLng] = useState<number | null>(null);
  const [dropoffConfirmed, setDropoffConfirmed] = useState(false);

  const [notes, setNotes] = useState('');

  useEffect(() => {
    api.getCarrierRoute(id)
      .then(setRoute)
      .catch((err) => setError(err.message));
  }, [id]);

  // Automatikus besorolás
  const classification = useMemo(() => {
    const L = Number(length), W = Number(width), H = Number(height), kg = Number(weight);
    if (!L || !W || !H || !kg) return null;
    return classifyPackage(L, W, H, kg);
  }, [length, width, height, weight]);

  // A szállító aktivált méretei
  const activeSizes = new Set((route?.prices || []).map((p) => p.size));
  const priceForSelectedSize = route?.prices.find((p) => p.size === classification);
  const szállítóVisziE = classification && activeSizes.has(classification);

  // Mi hiányzik a foglaláshoz — hogy ne legyen néma a letiltott gomb.
  const missingFields: string[] = [];
  if (!(Number(length) > 0 && Number(width) > 0 && Number(height) > 0 && Number(weight) > 0)) {
    missingFields.push('Csomag méretei és súlya');
  }
  if (!pickupConfirmed) missingFields.push('Felvételi cím (válaszd a legördülőből)');
  if (!dropoffConfirmed) missingFields.push('Célcím (válaszd a legördülőből)');
  if (classification && !szállítóVisziE) {
    missingFields.push('Ezt a csomagméretet a szállító nem vállalja ezen az útvonalon');
  }
  const canSubmit = missingFields.length === 0;

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!route) return;
    if (!canSubmit) {
      setError('Hiányzó adatok: ' + missingFields.join(', ') + '.');
      return;
    }
    setError(null);
    setSubmitting(true);
    try {
      const booking = await api.createRouteBooking(route.id, {
        length_cm: Number(length),
        width_cm: Number(width),
        height_cm: Number(height),
        weight_kg: Number(weight),
        pickup_address: pickupAddr,
        pickup_lat: pickupLat!,
        pickup_lng: pickupLng!,
        dropoff_address: dropoffAddr,
        dropoff_lat: dropoffLat!,
        dropoff_lng: dropoffLng!,
        notes: notes || undefined,
      });
      router.push(`/dashboard`);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setSubmitting(false);
    }
  }

  if (error && !route) return <div className="card" style={{ borderColor: 'var(--danger)' }}>Hiba: {error}</div>;
  if (!route) return <p>Betöltés…</p>;

  const isMine = !!me && route.carrier_id === me.id;

  return (
    <div style={{ maxWidth: 760 }}>
      <button
        type="button"
        className="btn btn-secondary"
        onClick={() => router.back()}
        style={{ marginBottom: 16 }}
      >
        ← Vissza
      </button>

      <h1>{route.title}</h1>
      <p className="muted">🗓 {new Date(route.departure_at).toLocaleString('hu-HU')}</p>

      {/* Saját poszt figyelmeztetés: a saját járatodon nem foglalhatsz
          helyet, de megnézheted/szerkesztheted. */}
      {isMine && (
        <div
          className="card on-light"
          style={{ background: '#fefce8', borderColor: '#facc15', marginTop: 16, color: 'var(--text)' }}
        >
          <h2 style={{ marginTop: 0, color: 'var(--text)' }}>📣 Ez a te saját járatod</h2>
          <p style={{ marginBottom: 8, color: '#334155' }}>
            A saját hirdetésedre nem foglalhatsz helyet. A foglalások
            kezeléséhez és szerkesztéshez nyisd meg a szállítói nézetet.
          </p>
          <Link className="btn" href={`/sofor/utvonal/${route.id}`}>
            Szállítói nézet →
          </Link>
        </div>
      )}

      {/* Útvonal */}
      <div className="card">
        <h2 style={{ marginTop: 0 }}>Útvonal</h2>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
          {route.waypoints.map((w, i) => (
            <div
              key={i}
              className="on-light"
              style={{
                background: i === 0 ? 'var(--success-light)' : i === route.waypoints.length - 1 ? 'var(--danger-light)' : 'var(--primary-subtle)',
                padding: '8px 14px',
                borderRadius: 999,
                fontSize: 14,
                border: `1px solid ${i === 0 ? '#86efac' : i === route.waypoints.length - 1 ? '#fca5a5' : '#93c5fd'}`,
              }}
            >
              <span style={{ fontSize: 11, opacity: 0.7, color: 'var(--text-secondary)' }}>
                {i === 0 ? 'INDULÁS · ' : i === route.waypoints.length - 1 ? 'CÉL · ' : `${i}. · `}
              </span>
              <strong style={{ color: 'var(--text)' }}>{w.name}</strong>
            </div>
          ))}
        </div>
        {route.vehicle_description && (
          <p className="muted" style={{ marginTop: 12 }}>🚛 {route.vehicle_description}</p>
        )}
        {route.description && (
          <p style={{ marginTop: 8, color: 'var(--text)', fontSize: 16, lineHeight: 1.5, whiteSpace: 'pre-wrap' }}>
            {route.description}
          </p>
        )}
      </div>

      {/* Elérhető árak */}
      <div className="card">
        <h2 style={{ marginTop: 0 }}>A szállító által vállalt méretek</h2>
        <div className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
          {PACKAGE_SIZES.map((ps) => {
            const price = route.prices.find((p) => p.size === ps.id);
            const active = !!price;
            return (
              <div
                key={ps.id}
                className={active ? 'on-light' : undefined}
                style={{
                  padding: 14,
                  borderRadius: 10,
                  border: `1px solid ${active ? '#93c5fd' : 'var(--border)'}`,
                  background: active ? '#eff6ff' : 'var(--surface-hover)',
                  opacity: active ? 1 : 0.6,
                  minWidth: 130,
                }}
              >
                <div style={{ fontWeight: 700, color: active ? 'var(--text)' : 'var(--text)' }}>
                  {ps.id} — {ps.label_hu}
                </div>
                <div style={{ fontSize: 11, marginTop: 4, color: active ? 'var(--text-secondary)' : 'var(--muted)' }}>
                  {ps.description_hu}
                </div>
                <div style={{ marginTop: 6, fontWeight: 800, fontSize: 16, color: active ? 'var(--primary)' : 'var(--muted)' }}>
                  {active ? `${price.price_huf.toLocaleString('hu-HU')} Ft` : 'nem vállalja'}
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* Foglalás form — saját posztnál nem jelenítjük meg, hogy el se
          lehessen kezdeni a foglalást. A backend is 403-mal utasítja el. */}
      {!isMine && (
      <form className="card" onSubmit={submit}>
        <h2 style={{ marginTop: 0 }}>Foglalás</h2>

        <h3>Csomagod adatai</h3>
        <div className="grid-2">
          <div>
            <label>Hossz (cm)</label>
            <input className="input" type="number" min={1} value={length} onChange={(e) => setLength(e.target.value.replace(/[^0-9]/g, ''))} required />
          </div>
          <div>
            <label>Szélesség (cm)</label>
            <input className="input" type="number" min={1} value={width} onChange={(e) => setWidth(e.target.value.replace(/[^0-9]/g, ''))} required />
          </div>
          <div>
            <label>Magasság (cm)</label>
            <input className="input" type="number" min={1} value={height} onChange={(e) => setHeight(e.target.value.replace(/[^0-9]/g, ''))} required />
          </div>
          <div>
            <label>Súly (kg)</label>
            <input className="input" type="number" step="0.1" min={0.1} value={weight} onChange={(e) => setWeight(e.target.value.replace(/[^0-9.,]/g, '').replace(',', '.'))} required />
          </div>
        </div>

        {/* Automatikus besorolás megjelenítése */}
        {classification && (
          <div
            className="card on-light"
            style={{
              marginTop: 12,
              padding: 12,
              background: szállítóVisziE ? 'var(--success-light)' : 'var(--danger-light)',
              borderColor: szállítóVisziE ? '#86efac' : '#fca5a5',
              color: 'var(--text)',
            }}
          >
            <strong>Besorolás: {classification}</strong>
            {szállítóVisziE ? (
              <> — ezt a szállító vállalja, <strong className="price">{priceForSelectedSize?.price_huf.toLocaleString('hu-HU')} Ft</strong></>
            ) : (
              <> — sajnos ezt a méretet a szállító nem vállalja ezen az útvonalon.</>
            )}
          </div>
        )}
        {!classification && length && width && height && weight && (
          <div className="card" style={{ marginTop: 12, padding: 12, background: 'var(--danger-light)', borderColor: 'var(--danger)' }}>
            A csomagod meghaladja az XL méretet — ez az útvonal nem alkalmas.
          </div>
        )}

        <h3 style={{ marginTop: 24 }}>Felvétel helye</h3>
        <AddressAutocomplete
          label="Cím"
          value={pickupAddr}
          onChange={(addr, lat, lng) => {
            setPickupAddr(addr);
            setPickupLat(lat);
            setPickupLng(lng);
            setPickupConfirmed(true);
          }}
          onTextChange={(text) => {
            setPickupAddr(text);
            setPickupConfirmed(false);
          }}
          required
        />
        {!pickupConfirmed && pickupAddr && (
          <p style={{ color: 'var(--warning)', fontSize: 12 }}>⚠ Válassz a legördülőből.</p>
        )}

        <h3 style={{ marginTop: 24 }}>Lerakodás helye</h3>
        <AddressAutocomplete
          label="Cím"
          value={dropoffAddr}
          onChange={(addr, lat, lng) => {
            setDropoffAddr(addr);
            setDropoffLat(lat);
            setDropoffLng(lng);
            setDropoffConfirmed(true);
          }}
          onTextChange={(text) => {
            setDropoffAddr(text);
            setDropoffConfirmed(false);
          }}
          required
        />
        {!dropoffConfirmed && dropoffAddr && (
          <p style={{ color: 'var(--warning)', fontSize: 12 }}>⚠ Válassz a legördülőből.</p>
        )}

        <label>Megjegyzés a szállítónak (opcionális)</label>
        <textarea
          className="input"
          rows={2}
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          placeholder="pl. törékeny, hívj felvételkor"
        />

        {error && <p style={{ color: 'var(--danger-text)', marginTop: 16 }}>{error}</p>}

        <button
          className="btn"
          type="submit"
          disabled={submitting}
          style={{ marginTop: 24, opacity: canSubmit ? 1 : 0.6 }}
        >
          {submitting ? 'Foglalás…' : `Helyet foglalok${priceForSelectedSize ? ` (${priceForSelectedSize.price_huf.toLocaleString('hu-HU')} Ft)` : ''}`}
        </button>
        {!canSubmit && (
          <p className="muted" style={{ fontSize: 12, marginTop: 8 }}>
            A foglaláshoz még hiányzik: {missingFields.join(', ')}.
          </p>
        )}
        <p className="muted" style={{ fontSize: 12, marginTop: 8 }}>
          A foglalást a szállítónak meg kell erősítenie. A megerősítés után egy kis
          kapcsolatfelvételi díjat fizetsz (bevezető ár), megkapod a szállító
          elérhetőségét, és a fuvar a szokásos módon megy: pickup fotó,
          átvételi kód — a fuvardíjat készpénzben adod át a szállítónak.
        </p>
      </form>
      )}
    </div>
  );
}
