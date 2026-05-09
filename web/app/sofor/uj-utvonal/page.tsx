'use client';

// Sofőr: új / szerkesztés útvonal hirdetés form.
// - Új mód: URL `/sofor/uj-utvonal`
// - Szerkesztés mód: URL `/sofor/uj-utvonal?edit=<id>` → betölti a
//   meglévő útvonalat, és a mentéskor PATCH-et hív POST helyett.
// - Mentés draft-ként vagy publikálás azonnal
import { useEffect, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { api, Waypoint } from '@/api';
import { PACKAGE_SIZES, PackageSizeId } from '@/lib/packageSizes';
import CityTagsInput from '@/components/CityTagsInput';

type SizeRow = {
  enabled: boolean;
  price: string; // stringként tároljuk, hogy a "" üres állapot kezelhető legyen
};

export default function UjUtvonal() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const editId = searchParams.get('edit');
  const isEdit = !!editId;

  const [submitting, setSubmitting] = useState(false);
  const [loading, setLoading] = useState(isEdit);
  const [error, setError] = useState<string | null>(null);

  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [vehicle, setVehicle] = useState('');
  const [waypoints, setWaypoints] = useState<Waypoint[]>([]);
  const [isRideAlong, setIsRideAlong] = useState(false);
  // datetime-local input kényelme miatt stringként kezeljük
  const [departureLocal, setDepartureLocal] = useState('');

  const [sizes, setSizes] = useState<Record<PackageSizeId, SizeRow>>({
    S: { enabled: false, price: '' },
    M: { enabled: true, price: '' },
    L: { enabled: true, price: '' },
    XL: { enabled: false, price: '' },
  });

  // Szerkesztés módban töltsük be a meglévő útvonalat
  useEffect(() => {
    if (!editId) return;
    setLoading(true);
    api.getCarrierRoute(editId)
      .then((r) => {
        setTitle(r.title);
        setDescription(r.description || '');
        setVehicle(r.vehicle_description || '');
        setWaypoints(r.waypoints || []);
        setIsRideAlong(!!r.is_ride_along);
        // Az ISO dátumot visszaalakítjuk datetime-local formátumra (YYYY-MM-DDTHH:MM)
        const d = new Date(r.departure_at);
        const pad = (n: number) => String(n).padStart(2, '0');
        const local =
          `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}` +
          `T${pad(d.getHours())}:${pad(d.getMinutes())}`;
        setDepartureLocal(local);
        // Méretek feltöltése a sofőr meglévő árai alapján
        const nextSizes: Record<PackageSizeId, SizeRow> = {
          S:  { enabled: false, price: '' },
          M:  { enabled: false, price: '' },
          L:  { enabled: false, price: '' },
          XL: { enabled: false, price: '' },
        };
        for (const p of r.prices || []) {
          nextSizes[p.size] = { enabled: true, price: String(p.price_huf) };
        }
        setSizes(nextSizes);
      })
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  }, [editId]);

  function toggleSize(id: PackageSizeId) {
    setSizes((prev) => ({
      ...prev,
      [id]: { ...prev[id], enabled: !prev[id].enabled },
    }));
  }

  function setSizePrice(id: PackageSizeId, price: string) {
    setSizes((prev) => ({
      ...prev,
      [id]: { ...prev[id], price: price.replace(/[^0-9]/g, '') },
    }));
  }

  function autoTitle() {
    if (waypoints.length < 2) return '';
    return `${waypoints[0].name} → ${waypoints[waypoints.length - 1].name}`;
  }

  const canSubmit =
    title.trim().length > 0 &&
    waypoints.length >= 2 &&
    departureLocal.length > 0 &&
    Object.values(sizes).some((s) => s.enabled && Number(s.price) > 0);

  async function submit(publishNow: boolean) {
    if (!canSubmit) return;
    setError(null);
    setSubmitting(true);
    try {
      const prices = Object.entries(sizes)
        .filter(([, s]) => s.enabled && Number(s.price) > 0)
        .map(([size, s]) => ({
          size: size as PackageSizeId,
          price_huf: Number(s.price),
        }));

      const body = {
        title,
        description: description || undefined,
        departure_at: new Date(departureLocal).toISOString(),
        waypoints,
        vehicle_description: vehicle || undefined,
        prices,
        status: (publishNow ? 'open' : 'draft') as 'open' | 'draft',
        is_ride_along: isRideAlong,
      };

      if (isEdit && editId) {
        await api.updateCarrierRoute(editId, body);
      } else {
        await api.createCarrierRoute(body);
      }
      router.push('/sofor/utvonalaim');
    } catch (err: any) {
      setError(err.message);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div style={{ maxWidth: 760 }}>
      <h1>{isEdit ? 'Útvonal szerkesztése' : 'Új útvonal hirdetése'}</h1>
      <p className="muted">
        {isEdit
          ? 'Módosítsd az útvonal részleteit. Mentheted piszkozatként vagy publikálhatod azonnal.'
          : 'Hirdesd meg az útvonalat amit bejársz — a feladók a csomagjaikat felkínálhatják rá. Te döntöd el, milyen méretű csomagokat viszel, és mennyiért.'}
      </p>

      {loading && <p>Betöltés…</p>}

      <form className="card" onSubmit={(e) => { e.preventDefault(); submit(true); }}>
        <h2 style={{ marginTop: 0 }}>Útvonal</h2>
        <CityTagsInput
          label="Városok (INDULÁS → megállók → CÉL)"
          value={waypoints}
          onChange={setWaypoints}
        />

        <label>Megnevezés</label>
        <input
          className="input"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder={autoTitle() || 'pl. Szeged → Budapest reggel'}
          required
        />
        <p className="muted" style={{ fontSize: 12 }}>
          {!title && autoTitle() && (
            <button
              type="button"
              onClick={() => setTitle(autoTitle())}
              style={{ background: 'none', border: 'none', color: 'var(--primary)', cursor: 'pointer', padding: 0 }}
            >
              → Automatikus név: „{autoTitle()}"
            </button>
          )}
        </p>

        <label>Indulás időpontja</label>
        <input
          className="input"
          type="datetime-local"
          value={departureLocal}
          onChange={(e) => setDepartureLocal(e.target.value)}
          required
        />

        <label>Jármű rövid leírása (opcionális)</label>
        <input
          className="input"
          value={vehicle}
          onChange={(e) => setVehicle(e.target.value)}
          placeholder="pl. Kisteherautó, 1 m³ szabad hely"
        />

        <label>Megjegyzés (opcionális)</label>
        <textarea
          className="input"
          rows={3}
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          placeholder="pl. Reggeli indulás 7-8 között. Csak nem törékeny áru."
        />

        {/* --- "Útba esik" toggle --- */}
        <div
          style={{
            marginTop: 24,
            padding: 16,
            background: isRideAlong ? 'rgba(46,125,50,0.1)' : 'transparent',
            border: `2px solid ${isRideAlong ? '#2E7D32' : 'var(--border)'}`,
            borderRadius: 8,
          }}
        >
          <div
            role="button"
            tabIndex={0}
            onClick={() => setIsRideAlong(!isRideAlong)}
            onKeyDown={(e) => e.key === 'Enter' && setIsRideAlong(!isRideAlong)}
            style={{ display: 'flex', gap: 12, alignItems: 'center', cursor: 'pointer' }}
          >
            <input
              type="checkbox"
              checked={isRideAlong}
              onChange={(e) => setIsRideAlong(e.target.checked)}
              style={{ width: 20, height: 20, flexShrink: 0 }}
            />
            <strong style={{ fontSize: 15 }}>🚗 Útba esik mód — amúgy is megyek erre</strong>
          </div>
          <p className="muted" style={{ fontSize: 13, marginTop: 8, marginBottom: 0 }}>
            Ha bejelölöd, a rendszer automatikusan kiajánlja neked az útvonaladba
            eső csomagokat, amiket minimális kitérővel felvehetsz. Mivel amúgy is
            mész erre, olcsóbban is vállalhatod — a feladóknak ez nagyon vonzó.
          </p>
        </div>

        <h2 style={{ marginTop: 32 }}>Csomag kategóriák és árak</h2>
        <p className="muted" style={{ marginTop: 0 }}>
          Pipáld be, amit vinnél, és add meg a saját árad forintban. A nem
          bepipált kategóriát a feladóknak nem is ajánljuk fel.
        </p>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          {PACKAGE_SIZES.map((ps) => {
            const row = sizes[ps.id];
            return (
              <div
                key={ps.id}
                className="card"
                style={{
                  margin: 0,
                  padding: 12,
                  background: row.enabled ? '#eff6ff' : '#f8fafc',
                  opacity: row.enabled ? 1 : 0.65,
                  display: 'flex',
                  alignItems: 'center',
                  gap: 12,
                }}
              >
                <input
                  type="checkbox"
                  checked={row.enabled}
                  onChange={() => toggleSize(ps.id)}
                  style={{ width: 20, height: 20, cursor: 'pointer' }}
                />
                <div style={{ flex: 1 }}>
                  <strong>{ps.id} — {ps.label_hu}</strong>
                  <div className="muted" style={{ fontSize: 12 }}>{ps.description_hu}</div>
                </div>
                <div style={{ width: 160 }}>
                  <input
                    className="input"
                    type="number"
                    inputMode="numeric"
                    value={row.price}
                    onChange={(e) => setSizePrice(ps.id, e.target.value)}
                    placeholder="Ft"
                    disabled={!row.enabled}
                    style={{ marginTop: 0 }}
                  />
                </div>
              </div>
            );
          })}
        </div>

        {error && <p style={{ color: 'var(--danger)', marginTop: 16 }}>{error}</p>}

        <div className="row" style={{ marginTop: 24, gap: 12 }}>
          <button className="btn" type="submit" disabled={!canSubmit || submitting}>
            {submitting ? 'Mentés…' : 'Publikálás most'}
          </button>
          <button
            className="btn btn-secondary"
            type="button"
            disabled={!canSubmit || submitting}
            onClick={() => submit(false)}
          >
            Mentés piszkozatként
          </button>
        </div>
      </form>
    </div>
  );
}
