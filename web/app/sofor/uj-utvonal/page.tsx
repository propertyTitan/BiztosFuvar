'use client';

// Szállító: új / szerkesztés útvonal hirdetés form.
// - Új mód: URL `/sofor/uj-utvonal`
// - Szerkesztés mód: URL `/sofor/uj-utvonal?edit=<id>` → betölti a
//   meglévő útvonalat, és a mentéskor PATCH-et hív POST helyett.
// - Mentés draft-ként vagy publikálás azonnal
import { Suspense, useEffect, useState } from 'react';
import { ListSkeleton } from '@/components/StateView';
import { useRouter, useSearchParams } from 'next/navigation';
import { api, Waypoint } from '@/api';
import { PACKAGE_SIZES, PackageSizeId } from '@/lib/packageSizes';
import CityTagsInput from '@/components/CityTagsInput';
import { useToast } from '@/components/ToastProvider';

type SizeRow = {
  enabled: boolean;
  price: string; // stringként tároljuk, hogy a "" üres állapot kezelhető legyen
};

function UjUtvonalContent() {
  const router = useRouter();
  const toast = useToast();
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
        // Méretek feltöltése a szállító meglévő árai alapján
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

  // --- Indulási időpont: a múlt tiltva ---------------------------------
  // A `min` attribútum a natív dátumválasztóban is elszürkíti a múltat, a
  // JS-ellenőrzés pedig a kézzel begépelt / beillesztett értéket fogja meg.
  // Szerkesztésnél egy MÁR ELINDULT járat időpontját nem tekintjük hibának
  // (különben a régi járatot nem lehetne menteni) — csak azt tiltjuk, hogy
  // valaki a múltba állítsa át.
  const [minDeparture, setMinDeparture] = useState('');
  useEffect(() => {
    const tick = () => {
      const d = new Date();
      const pad = (n: number) => String(n).padStart(2, '0');
      setMinDeparture(
        `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}` +
        `T${pad(d.getHours())}:${pad(d.getMinutes())}`,
      );
    };
    tick();
    // percenként frissítjük, hogy egy sokáig nyitva hagyott űrlapon se
    // csússzon el a korlát
    const t = setInterval(tick, 60_000);
    return () => clearInterval(t);
  }, []);

  const departureInPast =
    departureLocal.length > 0 && new Date(departureLocal).getTime() < Date.now();

  function autoTitle() {
    if (waypoints.length < 2) return '';
    return `${waypoints[0].name} → ${waypoints[waypoints.length - 1].name}`;
  }

  // Mi hiányzik a publikáláshoz — ezt jelezzük a usernek, hogy ne maradjon
  // néma a letiltott gomb (korábban: kattintásra semmi sem történt, se hiba).
  const missingFields: string[] = [];
  if (title.trim().length === 0) missingFields.push('Megnevezés');
  if (waypoints.length < 2) missingFields.push('Legalább 2 város (indulás és cél)');
  if (departureLocal.length === 0) missingFields.push('Indulás időpontja');
  else if (departureInPast) missingFields.push('Jövőbeli indulási időpont (a megadott időpont már elmúlt)');
  if (!Object.values(sizes).some((s) => s.enabled && Number(s.price) > 0)) {
    missingFields.push('Legalább egy csomagméret bepipálva, megadott árral');
  }
  const canSubmit = missingFields.length === 0;

  async function submit(publishNow: boolean) {
    if (!canSubmit) {
      // GF-018 (Manus, 2026-08-30): a kattintás eddig NÉMÁN nem csinált
      // semmit (a hiány-lista a gombok alatt látszott ugyan, de a
      // felhasználó a gombra nézett). Most explicit toast is szól.
      toast.error(
        publishNow ? 'A publikáláshoz még hiányzik' : 'A piszkozat mentéséhez még hiányzik',
        missingFields.join(' · '),
      );
      return;
    }
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
      <h1>{isEdit ? 'Járat szerkesztése' : 'Új járat hirdetése'}</h1>
      <p className="muted">
        {isEdit
          ? 'Módosítsd az útvonal részleteit. Mentheted piszkozatként vagy publikálhatod azonnal.'
          : 'Hirdesd meg az útvonalat amit bejársz — a feladók a csomagjaikat felkínálhatják rá. Te döntöd el, milyen méretű csomagokat viszel, és mennyiért.'}
      </p>

      {loading && <ListSkeleton rows={3} />}

      <form noValidate className="card" onSubmit={(e) => { e.preventDefault(); submit(true); }}>
        <h2 style={{ marginTop: 0 }}>Útvonal</h2>
        <CityTagsInput
          label="Városok (INDULÁS → megállók → CÉL)"
          value={waypoints}
          onChange={setWaypoints}
        />

        <label htmlFor="jarat-megnevezes">Megnevezés</label>
        <input id="jarat-megnevezes"
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
              style={{ background: 'none', border: 'none', color: 'var(--primary-text)', cursor: 'pointer', padding: 0 }}
            >
              → Automatikus név: „{autoTitle()}”
            </button>
          )}
        </p>

        <label htmlFor="jarat-indulas-idopontja">Indulás időpontja</label>
        <input id="jarat-indulas-idopontja"
          className="input"
          type="datetime-local"
          value={departureLocal}
          min={minDeparture}
          title="Csak jövőbeli időpont adható meg — múltbeli indulásra nem lehet járatot hirdetni."
          onChange={(e) => setDepartureLocal(e.target.value)}
          required
        />
        {departureInPast && (
          <p role="alert" style={{ color: 'var(--danger-text)', fontSize: 12, marginTop: 4 }}>
            Ez az időpont már elmúlt. Válassz jövőbeli indulást — múltbeli
            járatot nem lehet meghirdetni.
          </p>
        )}

        <label htmlFor="jarat-jarmu-rovid-leirasa">Jármű rövid leírása (opcionális)</label>
        <input id="jarat-jarmu-rovid-leirasa"
          className="input"
          value={vehicle}
          onChange={(e) => setVehicle(e.target.value)}
          placeholder="pl. Kisteherautó, 1 m³ szabad hely"
        />

        <label htmlFor="jarat-megjegyzes">Megjegyzés (opcionális)</label>
        <textarea id="jarat-megjegyzes"
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
            border: `2px solid ${isRideAlong ? 'var(--success)' : 'var(--border)'}`,
            borderRadius: 8,
          }}
        >
          {/* Lásd az uj-fuvar oldal azonos javítását: a `<label>` natívan
              adja a kattintást, a Szóközt és a felolvasott állapotot —
              szemben a `div role="button"`-nal, ami a benne ülő
              jelölőnégyzetet elnyelte (axe: nested-interactive). */}
          <label
            style={{ display: 'flex', gap: 12, alignItems: 'center', cursor: 'pointer' }}
          >
            <input
              type="checkbox"
              checked={isRideAlong}
              onChange={(e) => setIsRideAlong(e.target.checked)}
              style={{ width: 20, height: 20, flexShrink: 0 }}
            />
            <strong style={{ fontSize: 16 }}>🚗 Útba esik mód — amúgy is megyek erre</strong>
          </label>
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
                  background: row.enabled ? 'var(--primary-subtle)' : 'var(--bg)',
                  opacity: row.enabled ? 1 : 0.65,
                  display: 'flex',
                  alignItems: 'center',
                  gap: 12,
                }}
              >
                {/* A sor „címkéje" vizuálisan a mellette lévő <strong>, de az
                    programozottan nincs a mezőhöz kötve — a képernyőolvasó
                    névtelen jelölőnégyzetet és névtelen szám-mezőt olvasott fel,
                    négyszer egymás után (axe: `label`, critical). A méretkód a
                    listából jön, ezért aria-labelt adunk, nem statikus <label>-t. */}
                <input
                  type="checkbox"
                  aria-label={`${ps.label_hu} méret vállalása`}
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
                    aria-label={`${ps.label_hu} méret ára forintban`}
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

        {error && <p style={{ color: 'var(--danger-text)', marginTop: 16 }}>{error}</p>}

        <div className="row" style={{ marginTop: 24, gap: 12 }}>
          <button className="btn" type="submit" disabled={submitting}>
            {submitting ? 'Mentés…' : 'Publikálás most'}
          </button>
          <button
            className="btn btn-secondary"
            type="button"
            disabled={submitting}
            onClick={() => submit(false)}
          >
            Mentés piszkozatként
          </button>
        </div>

        {!canSubmit && (
          <p className="muted" style={{ fontSize: 13, marginTop: 12 }}>
            A publikáláshoz még hiányzik: {missingFields.join(', ')}.
          </p>
        )}
      </form>
    </div>
  );
}

export default function UjUtvonal() {
  return (
    <Suspense fallback={null}>
      <UjUtvonalContent />
    </Suspense>
  );
}
