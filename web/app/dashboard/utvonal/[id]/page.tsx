'use client';

// Feladó: egy konkrét sofőri útvonal részletei + foglalás form.
// - Az útvonal, árak, időpont
// - Foglalás form: csomag méretei + súly + pickup/dropoff cím autocomplete
// - Automatikus méret-besorolás
// - "Helyet foglalok" gomb → beállítja a státuszt pending-re (sofőrre vár)
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

  // A sofőr aktivált méretei
  const activeSizes = new Set((route?.prices || []).map((p) => p.size));
  const priceForSelectedSize = route?.prices.find((p) => p.size === classification);
  const sofőrVisziE = classification && activeSizes.has(classification);

  const canSubmit =
    classification &&
    sofőrVisziE &&
    pickupConfirmed &&
    dropoffConfirmed &&
    Number(length) > 0 &&
    Number(width) > 0 &&
    Number(height) > 0 &&
    Number(weight) > 0;

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!canSubmit || !route) return;
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

      {/* Saját poszt figyelmeztetés: a saját útvonaladon nem foglalhatsz
          helyet, de megnézheted/szerkesztheted. */}
      {isMine && (
        <div
          className="card on-light"
          style={{ background: '#fefce8', borderColor: '#facc15', marginTop: 16, color: '#0f172a' }}
        >
          <h2 style={{ marginTop: 0, color: '#0f172a' }}>📣 Ez a te saját útvonalad</h2>
          <p style={{ marginBottom: 8, color: '#334155' }}>
            A saját hirdetésedre nem foglalhatsz helyet. A foglalások
            kezeléséhez és szerkesztéshez nyisd meg a sofőri nézetet.
          </p>
          <Link className="btn" href={`/sofor/utvonal/${route.id}`}>
            Sofőri nézet →
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
                background: i === 0 ? '#dcfce7' : i === route.waypoints.length - 1 ? '#fee2e2' : '#dbeafe',
                padding: '8px 14px',
                borderRadius: 999,
                fontSize: 14,
                border: `1px solid ${i === 0 ? '#86efac' : i === route.waypoints.length - 1 ? '#fca5a5' : '#93c5fd'}`,
              }}
            >
              <span style={{ fontSize: 11, opacity: 0.7, color: '#475569' }}>
                {i === 0 ? 'INDULÁS · ' : i === route.waypoints.length - 1 ? 'CÉL · ' : `${i}. · `}
              </span>
              <strong style={{ color: '#0f172a' }}>{w.name}</strong>
            </div>
          ))}
        </div>
        {route.vehicle_description && (
          <p className="muted" style={{ marginTop: 12 }}>🚛 {route.vehicle_description}</p>
        )}
        {route.description && (
          <p style={{ marginTop: 8, color: 'var(--text)', fontSize: 15, lineHeight: 1.5, whiteSpace: 'pre-wrap' }}>
            {route.description}
          </p>
        )}
      </div>

      {/* Elérhető árak */}
      <div className="card">
        <h2 style={{ marginTop: 0 }}>A sofőr által vállalt méretek</h2>
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
                <div style={{ fontWeight: 700, color: active ? '#0f172a' : 'var(--text)' }}>
                  {ps.id} — {ps.label_hu}
                </div>
                <div style={{ fontSize: 11, marginTop: 4, color: active ? '#475569' : 'var(--muted)' }}>
                  {ps.description_hu}
                </div>
                <div style={{ marginTop: 6, fontWeight: 800, fontSize: 15, color: active ? '#1e40af' : 'var(--muted)' }}>
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
              background: sofőrVisziE ? '#dcfce7' : '#fee2e2',
              borderColor: sofőrVisziE ? '#86efac' : '#fca5a5',
              color: '#0f172a',
            }}
          >
            <strong>Besorolás: {classification}</strong>
            {sofőrVisziE ? (
              <> — ezt a sofőr vállalja, <strong className="price">{priceForSelectedSize?.price_huf.toLocaleString('hu-HU')} Ft</strong></>
            ) : (
              <> — sajnos ezt a méretet a sofőr nem vállalja ezen az útvonalon.</>
            )}
          </div>
        )}
        {!classification && length && width && height && weight && (
          <div className="card" style={{ marginTop: 12, padding: 12, background: '#fee2e2', borderColor: 'var(--danger)' }}>
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

        <label>Megjegyzés a sofőrnek (opcionális)</label>
        <textarea
          className="input"
          rows={2}
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          placeholder="pl. törékeny, hívj felvételkor"
        />

        {error && <p style={{ color: 'var(--danger)', marginTop: 16 }}>{error}</p>}

        <button
          className="btn"
          type="submit"
          disabled={!canSubmit || submitting}
          style={{ marginTop: 24, opacity: canSubmit ? 1 : 0.5 }}
        >
          {submitting ? 'Foglalás…' : `Helyet foglalok${priceForSelectedSize ? ` (${priceForSelectedSize.price_huf.toLocaleString('hu-HU')} Ft)` : ''}`}
        </button>
        <p className="muted" style={{ fontSize: 12, marginTop: 8 }}>
          A foglalást a sofőrnek meg kell erősítenie. A megerősítés után a
          Barion letétbe helyezi a fuvardíjat, és a fuvar a szokásos módon megy:
          pickup fotó, átvételi kód, kifizetés.
        </p>
      </form>
      )}
    </div>
  );
}
