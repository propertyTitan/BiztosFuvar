'use client';

// =====================================================================
//  Új fuvar feladása – feladói űrlap.
//
//  - Google Places Autocomplete a címekhez: amint a user kiválaszt egy
//    címet a legördülőből, automatikusan beíródik a koordináta is.
//    Kézi szerkesztés esetén (ha a user CSAK a szöveget írja át, de nem
//    választ a listából) a koordináta frissen nem lesz érvényes → a
//    Küldés gomb letiltva, és figyelmeztetést mutatunk.
//  - Kötelező csomag-méretek: hossz × szélesség × magasság (cm).
//    A térfogatot NEM a user adja meg – a backend automatikusan számolja.
// =====================================================================
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { api } from '@/api';
import AddressAutocomplete from '@/components/AddressAutocomplete';

type FormState = {
  title: string;
  description: string;

  pickup_address: string;
  pickup_lat: number | null;
  pickup_lng: number | null;
  pickup_confirmed: boolean; // true ha kiválasztotta az autocomplete-ből

  dropoff_address: string;
  dropoff_lat: number | null;
  dropoff_lng: number | null;
  dropoff_confirmed: boolean;

  weight_kg: number | '';
  length_cm: number | '';
  width_cm: number | '';
  height_cm: number | '';
  suggested_price_huf: number | '';
};

const initialForm: FormState = {
  title: '',
  description: '',
  pickup_address: '',
  pickup_lat: null,
  pickup_lng: null,
  pickup_confirmed: false,
  dropoff_address: '',
  dropoff_lat: null,
  dropoff_lng: null,
  dropoff_confirmed: false,
  weight_kg: '',
  length_cm: '',
  width_cm: '',
  height_cm: '',
  suggested_price_huf: '',
};

export default function UjFuvar() {
  const router = useRouter();
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [form, setForm] = useState<FormState>(initialForm);

  function set<K extends keyof FormState>(key: K, value: FormState[K]) {
    setForm((prev) => ({ ...prev, [key]: value }));
  }

  // Automatikus térfogat kiszámítás (csak a kijelzéshez – a backend is számolja)
  const volumeM3 =
    form.length_cm && form.width_cm && form.height_cm
      ? +(
          (Number(form.length_cm) * Number(form.width_cm) * Number(form.height_cm)) /
          1_000_000
        ).toFixed(3)
      : null;

  const canSubmit =
    form.title.trim() &&
    form.pickup_confirmed &&
    form.dropoff_confirmed &&
    form.length_cm && form.width_cm && form.height_cm &&
    form.weight_kg &&
    form.suggested_price_huf;

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!canSubmit) return;
    setSubmitting(true);
    setError(null);
    try {
      const job = await api.createJob({
        title: form.title,
        description: form.description,
        pickup_address: form.pickup_address,
        pickup_lat: form.pickup_lat!,
        pickup_lng: form.pickup_lng!,
        dropoff_address: form.dropoff_address,
        dropoff_lat: form.dropoff_lat!,
        dropoff_lng: form.dropoff_lng!,
        weight_kg: Number(form.weight_kg),
        length_cm: Number(form.length_cm),
        width_cm: Number(form.width_cm),
        height_cm: Number(form.height_cm),
        suggested_price_huf: Number(form.suggested_price_huf),
      });
      router.push(`/dashboard?created=${job.id}`);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div style={{ maxWidth: 720 }}>
      <h1>Új fuvar feladása</h1>
      <p className="muted">
        Add meg a fuvar adatait. A cím automatikusan kiegészíthető térképről,
        és az AI ellenőrzi a leírást.
      </p>

      <form className="card" onSubmit={onSubmit}>
        <label>Megnevezés</label>
        <input
          className="input"
          value={form.title}
          onChange={(e) => set('title', e.target.value)}
          placeholder="Pl. Költöztetés Budapest → Debrecen"
          required
        />

        <label>Részletes leírás</label>
        <textarea
          className="input"
          rows={3}
          value={form.description}
          onChange={(e) => set('description', e.target.value)}
          placeholder="Mit viszünk? Lift van? Kézi cipelés?"
        />

        {/* --- Felvétel --- */}
        <h2 style={{ marginTop: 24 }}>Felvétel helye</h2>
        <AddressAutocomplete
          label="Cím (kezdd el beírni, majd válassz a listából)"
          value={form.pickup_address}
          onChange={(addr, lat, lng) =>
            setForm((f) => ({
              ...f,
              pickup_address: addr,
              pickup_lat: lat,
              pickup_lng: lng,
              pickup_confirmed: true,
            }))
          }
          onTextChange={(text) =>
            setForm((f) => ({
              ...f,
              pickup_address: text,
              // ha a user kézzel piszkálja a szöveget, a koordináta már nem érvényes
              pickup_confirmed: false,
            }))
          }
          required
        />
        {form.pickup_confirmed && form.pickup_lat != null && (
          <p className="muted" style={{ fontSize: 12, marginTop: 6 }}>
            ✓ Koordináta: {form.pickup_lat.toFixed(5)}, {form.pickup_lng!.toFixed(5)}
          </p>
        )}
        {!form.pickup_confirmed && form.pickup_address && (
          <p style={{ color: 'var(--warning)', fontSize: 12, marginTop: 6 }}>
            ⚠ Válassz egy címet a legördülő listából a pontos koordinátához.
          </p>
        )}

        {/* --- Lerakodás --- */}
        <h2 style={{ marginTop: 24 }}>Lerakodás helye</h2>
        <AddressAutocomplete
          label="Cím (kezdd el beírni, majd válassz a listából)"
          value={form.dropoff_address}
          onChange={(addr, lat, lng) =>
            setForm((f) => ({
              ...f,
              dropoff_address: addr,
              dropoff_lat: lat,
              dropoff_lng: lng,
              dropoff_confirmed: true,
            }))
          }
          onTextChange={(text) =>
            setForm((f) => ({
              ...f,
              dropoff_address: text,
              dropoff_confirmed: false,
            }))
          }
          required
        />
        {form.dropoff_confirmed && form.dropoff_lat != null && (
          <p className="muted" style={{ fontSize: 12, marginTop: 6 }}>
            ✓ Koordináta: {form.dropoff_lat.toFixed(5)}, {form.dropoff_lng!.toFixed(5)}
          </p>
        )}
        {!form.dropoff_confirmed && form.dropoff_address && (
          <p style={{ color: 'var(--warning)', fontSize: 12, marginTop: 6 }}>
            ⚠ Válassz egy címet a legördülő listából a pontos koordinátához.
          </p>
        )}

        {/* --- Csomag adatai --- */}
        <h2 style={{ marginTop: 24 }}>Csomag adatai</h2>
        <p className="muted" style={{ fontSize: 13, marginTop: 0 }}>
          Kötelező – a sofőr ezek alapján dönti el, belefér-e a járművébe,
          és hogy a jármű össztömeg-korlátját nem lépi-e át.
        </p>
        <div className="grid-2">
          <div>
            <label>Hosszúság (cm)</label>
            <input
              className="input"
              type="number"
              min={1}
              value={form.length_cm}
              onChange={(e) =>
                set('length_cm', e.target.value === '' ? '' : Number(e.target.value))
              }
              placeholder="pl. 120"
              required
            />
          </div>
          <div>
            <label>Szélesség (cm)</label>
            <input
              className="input"
              type="number"
              min={1}
              value={form.width_cm}
              onChange={(e) =>
                set('width_cm', e.target.value === '' ? '' : Number(e.target.value))
              }
              placeholder="pl. 80"
              required
            />
          </div>
          <div>
            <label>Magasság (cm)</label>
            <input
              className="input"
              type="number"
              min={1}
              value={form.height_cm}
              onChange={(e) =>
                set('height_cm', e.target.value === '' ? '' : Number(e.target.value))
              }
              placeholder="pl. 100"
              required
            />
          </div>
          <div>
            <label>Súly (kg)</label>
            <input
              className="input"
              type="number"
              min={1}
              step="0.1"
              value={form.weight_kg}
              onChange={(e) =>
                set('weight_kg', e.target.value === '' ? '' : Number(e.target.value))
              }
              placeholder="pl. 350"
              required
            />
          </div>
        </div>
        {volumeM3 != null && (
          <p className="muted" style={{ fontSize: 12, marginTop: 8 }}>
            Számolt térfogat: <strong>{volumeM3} m³</strong>
          </p>
        )}

        {/* --- Ár --- */}
        <h2 style={{ marginTop: 24 }}>Javasolt fuvardíj</h2>
        <label>Összeg (Ft)</label>
        <input
          className="input"
          type="number"
          min={1}
          value={form.suggested_price_huf}
          onChange={(e) =>
            set('suggested_price_huf', e.target.value === '' ? '' : Number(e.target.value))
          }
          placeholder="pl. 65000"
          required
        />

        {error && <p style={{ color: 'var(--danger)', marginTop: 16 }}>{error}</p>}

        <button
          className="btn"
          type="submit"
          disabled={!canSubmit || submitting}
          style={{ marginTop: 24, opacity: canSubmit ? 1 : 0.5 }}
        >
          {submitting ? 'Feladás...' : 'Fuvar feladása'}
        </button>
      </form>
    </div>
  );
}
