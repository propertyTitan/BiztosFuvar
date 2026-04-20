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
import { useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { api } from '@/api';
import AddressAutocomplete from '@/components/AddressAutocomplete';
import { useToast } from '@/components/ToastProvider';

const MAX_PHOTO_BYTES = 10 * 1024 * 1024; // 10 MB – egyezik a backend limittel
const MAX_PHOTO_COUNT = 8;

const FLOOR_OPTIONS = [
  { value: '0', label: 'Földszint' },
  { value: '1', label: '1. emelet' },
  { value: '2', label: '2. emelet' },
  { value: '3', label: '3. emelet' },
  { value: '4', label: '4. emelet' },
  { value: '5', label: '5. emelet' },
  { value: '6', label: '6. emelet' },
  { value: '7', label: '7. emelet' },
  { value: '8', label: '8. emelet' },
  { value: '9', label: '9. emelet' },
  { value: '10', label: '10. emelet' },
] as const;

type FormState = {
  title: string;
  description: string;

  pickup_address: string;
  pickup_lat: number | null;
  pickup_lng: number | null;
  pickup_confirmed: boolean;

  dropoff_address: string;
  dropoff_lat: number | null;
  dropoff_lng: number | null;
  dropoff_confirmed: boolean;

  weight_kg: number | '';
  length_cm: number | '';
  width_cm: number | '';
  height_cm: number | '';
  suggested_price_huf: number | '';
  declared_value_huf: number | '';

  is_instant: boolean;
  instant_duration_minutes: number | '';
  instant_radius_km: number | '';

  pickup_needs_carrying: boolean;
  pickup_floor: string;
  pickup_has_elevator: boolean;
  dropoff_needs_carrying: boolean;
  dropoff_floor: string;
  dropoff_has_elevator: boolean;
  invoice_requested: boolean;
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
  declared_value_huf: '',
  is_instant: false,
  instant_duration_minutes: 30,
  instant_radius_km: 20,
  pickup_needs_carrying: false,
  pickup_floor: '0',
  pickup_has_elevator: false,
  dropoff_needs_carrying: false,
  dropoff_floor: '0',
  dropoff_has_elevator: false,
  invoice_requested: false,
};

const REQ = { color: '#EF4444', fontWeight: 700 } as const;
const redBorder = { border: '2px solid #EF4444', boxShadow: '0 0 0 3px rgba(239,68,68,0.15)' } as const;

export default function UjFuvar() {
  const router = useRouter();
  const toast = useToast();
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [form, setForm] = useState<FormState>(initialForm);
  const [photos, setPhotos] = useState<File[]>([]);
  const [uploadProgress, setUploadProgress] = useState<string | null>(null);
  const [tried, setTried] = useState(false);

  function missing(filled: unknown): boolean {
    if (!tried) return false;
    if (typeof filled === 'string') return !filled.trim();
    if (typeof filled === 'number') return false;
    return !filled;
  }

  // Előnézeti URL-ek a kiválasztott képekhez. Memoizáljuk, mert a URL.createObjectURL
  // memória-leak-et okozhat, ha minden renderre új URL-t generálunk.
  const photoPreviews = useMemo(
    () => photos.map((f) => ({ file: f, url: URL.createObjectURL(f) })),
    [photos],
  );

  function set<K extends keyof FormState>(key: K, value: FormState[K]) {
    setForm((prev) => ({ ...prev, [key]: value }));
  }

  function onPickPhotos(e: React.ChangeEvent<HTMLInputElement>) {
    const files = Array.from(e.target.files || []);
    const valid: File[] = [];
    for (const f of files) {
      if (!f.type.startsWith('image/')) continue;
      if (f.size > MAX_PHOTO_BYTES) {
        setError(`"${f.name}" túl nagy (max ${MAX_PHOTO_BYTES / 1024 / 1024} MB képenként).`);
        continue;
      }
      valid.push(f);
    }
    const merged = [...photos, ...valid].slice(0, MAX_PHOTO_COUNT);
    setPhotos(merged);
    // fontos: reset, különben ugyanaz a fájl kétszer nem választható újra
    e.target.value = '';
  }

  function removePhoto(index: number) {
    setPhotos((prev) => prev.filter((_, i) => i !== index));
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
    setTried(true);
    if (!canSubmit) {
      toast.error('Hiányzó mezők', 'Kérlek töltsd ki az összes kötelező (*) mezőt.');
      return;
    }
    setSubmitting(true);
    setError(null);
    setUploadProgress(null);
    try {
      // 1) Létrehozzuk a fuvart – ekkor kapunk jobId-t
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
        is_instant: form.is_instant,
        ...(form.is_instant && form.instant_duration_minutes
          ? { instant_duration_minutes: Number(form.instant_duration_minutes) }
          : {}),
        ...(form.is_instant && form.instant_radius_km
          ? { instant_radius_km: Number(form.instant_radius_km) }
          : {}),
        pickup_needs_carrying: form.pickup_needs_carrying,
        ...(form.pickup_needs_carrying ? {
          pickup_floor: Number(form.pickup_floor),
          pickup_has_elevator: form.pickup_has_elevator,
        } : {}),
        dropoff_needs_carrying: form.dropoff_needs_carrying,
        ...(form.dropoff_needs_carrying ? {
          dropoff_floor: Number(form.dropoff_floor),
          dropoff_has_elevator: form.dropoff_has_elevator,
        } : {}),
        ...(form.declared_value_huf ? { declared_value_huf: Number(form.declared_value_huf) } : {}),
        invoice_requested: form.invoice_requested,
      });

      // 2) Kép-feltöltés sorban (így látjuk a progress-t és nem önmagával versenyez
      //    a backend AI/tárolás réteg).
      for (let i = 0; i < photos.length; i++) {
        setUploadProgress(`Fotó feltöltés: ${i + 1} / ${photos.length}…`);
        try {
          await api.uploadJobPhoto(job.id, photos[i], 'listing');
        } catch (err: any) {
          // nem törjük meg a fuvar létrejöttét egy hibás fotó miatt,
          // csak naplózzuk és továbbmegyünk
          console.warn('Fotó feltöltés hiba:', err.message);
        }
      }

      toast.success(
        'Fuvar feladva',
        photos.length > 0 ? `${photos.length} fotóval együtt` : undefined,
      );
      router.push(`/dashboard/fuvar/${job.id}`);
    } catch (err: any) {
      setError(err.message);
      toast.error('Hiba a fuvar feladáskor', err.message);
    } finally {
      setSubmitting(false);
      setUploadProgress(null);
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
        <label>Megnevezés <span style={REQ}>*</span></label>
        <input
          className="input"
          value={form.title}
          onChange={(e) => set('title', e.target.value)}
          placeholder="Pl. Költöztetés Budapest → Debrecen"
          required
          style={missing(form.title) ? redBorder : undefined}
        />

        <label>Részletes leírás</label>
        <textarea
          className="input"
          rows={3}
          value={form.description}
          onChange={(e) => set('description', e.target.value)}
          placeholder="Mit viszünk? Lift van? Kézi cipelés?"
        />

        {/* --- Fotók --- */}
        <h2 style={{ marginTop: 24 }}>Fotók a csomagról</h2>
        <p className="muted" style={{ fontSize: 13, marginTop: 0 }}>
          Opcionális, de erősen ajánlott. A sofőrök pontosabb licitet adnak,
          ha látják, mit kell szállítani. Max {MAX_PHOTO_COUNT} kép, fotónként
          legfeljebb {MAX_PHOTO_BYTES / 1024 / 1024} MB.
        </p>
        <input
          type="file"
          accept="image/*"
          multiple
          onChange={onPickPhotos}
          disabled={photos.length >= MAX_PHOTO_COUNT}
          style={{ marginTop: 4 }}
        />
        {photoPreviews.length > 0 && (
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fill, minmax(120px, 1fr))',
              gap: 8,
              marginTop: 12,
            }}
          >
            {photoPreviews.map((p, i) => (
              <div
                key={i}
                style={{
                  position: 'relative',
                  borderRadius: 8,
                  overflow: 'hidden',
                  border: '1px solid var(--border)',
                  aspectRatio: '1 / 1',
                }}
              >
                <img
                  src={p.url}
                  alt={p.file.name}
                  style={{ width: '100%', height: '100%', objectFit: 'cover' }}
                />
                <button
                  type="button"
                  onClick={() => removePhoto(i)}
                  title="Eltávolítás"
                  style={{
                    position: 'absolute',
                    top: 4,
                    right: 4,
                    background: 'rgba(0,0,0,0.65)',
                    color: '#fff',
                    border: 'none',
                    borderRadius: '50%',
                    width: 24,
                    height: 24,
                    cursor: 'pointer',
                    fontSize: 14,
                    lineHeight: 1,
                  }}
                >
                  ×
                </button>
              </div>
            ))}
          </div>
        )}

        {/* --- Felvétel --- */}
        <h2 style={{ marginTop: 24 }}>Felvétel helye <span style={REQ}>*</span></h2>
        <div style={missing(form.pickup_confirmed ? 'ok' : '') ? { ...redBorder, borderRadius: 8, padding: 2 } : undefined}>
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
        </div>

        {/* Felvételi bepakolás */}
        <div style={{ marginTop: 12 }}>
          <label style={{ display: 'flex', gap: 10, alignItems: 'center', cursor: 'pointer' }}>
            <input
              type="checkbox"
              checked={form.pickup_needs_carrying}
              onChange={(e) => set('pickup_needs_carrying', e.target.checked)}
              style={{ width: 18, height: 18 }}
            />
            <span style={{ fontSize: 14 }}>
              A sofőrnek be kell pakolnia a csomagot a felvételi helyen?
            </span>
          </label>
          {form.pickup_needs_carrying && (
            <div
              style={{
                marginTop: 10,
                marginLeft: 28,
                padding: 12,
                background: 'rgba(255,255,255,0.05)',
                border: '1px solid var(--border)',
                borderRadius: 8,
              }}
            >
              <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap', alignItems: 'end' }}>
                <div>
                  <label style={{ fontSize: 13 }}>Hányadik emelet? <span style={REQ}>*</span></label>
                  <select
                    className="input"
                    value={form.pickup_floor}
                    onChange={(e) => set('pickup_floor', e.target.value)}
                    style={{ minWidth: 150 }}
                  >
                    {FLOOR_OPTIONS.map((o) => (
                      <option key={o.value} value={o.value}>{o.label}</option>
                    ))}
                  </select>
                </div>
                {form.pickup_floor !== '0' && (
                  <label style={{ display: 'flex', gap: 8, alignItems: 'center', cursor: 'pointer', fontSize: 14 }}>
                    <input
                      type="checkbox"
                      checked={form.pickup_has_elevator}
                      onChange={(e) => set('pickup_has_elevator', e.target.checked)}
                      style={{ width: 18, height: 18 }}
                    />
                    Van lift?
                  </label>
                )}
              </div>
              {form.pickup_floor !== '0' && !form.pickup_has_elevator && (
                <p style={{ fontSize: 12, color: '#FB8C00', marginTop: 8, marginBottom: 0 }}>
                  ⚠ Lépcsőn kell cipelni — a sofőrnek lényeges információ!
                </p>
              )}
            </div>
          )}
        </div>

        {/* --- Lerakodás --- */}
        <h2 style={{ marginTop: 24 }}>Lerakodás helye <span style={REQ}>*</span></h2>
        <div style={missing(form.dropoff_confirmed ? 'ok' : '') ? { ...redBorder, borderRadius: 8, padding: 2 } : undefined}>
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
        </div>

        {/* Lerakodási bepakolás */}
        <div style={{ marginTop: 12 }}>
          <label style={{ display: 'flex', gap: 10, alignItems: 'center', cursor: 'pointer' }}>
            <input
              type="checkbox"
              checked={form.dropoff_needs_carrying}
              onChange={(e) => set('dropoff_needs_carrying', e.target.checked)}
              style={{ width: 18, height: 18 }}
            />
            <span style={{ fontSize: 14 }}>
              A sofőrnek fel kell vinnie a csomagot a lerakodási helyen?
            </span>
          </label>
          {form.dropoff_needs_carrying && (
            <div
              style={{
                marginTop: 10,
                marginLeft: 28,
                padding: 12,
                background: 'rgba(255,255,255,0.05)',
                border: '1px solid var(--border)',
                borderRadius: 8,
              }}
            >
              <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap', alignItems: 'end' }}>
                <div>
                  <label style={{ fontSize: 13 }}>Hányadik emelet? <span style={REQ}>*</span></label>
                  <select
                    className="input"
                    value={form.dropoff_floor}
                    onChange={(e) => set('dropoff_floor', e.target.value)}
                    style={{ minWidth: 150 }}
                  >
                    {FLOOR_OPTIONS.map((o) => (
                      <option key={o.value} value={o.value}>{o.label}</option>
                    ))}
                  </select>
                </div>
                {form.dropoff_floor !== '0' && (
                  <label style={{ display: 'flex', gap: 8, alignItems: 'center', cursor: 'pointer', fontSize: 14 }}>
                    <input
                      type="checkbox"
                      checked={form.dropoff_has_elevator}
                      onChange={(e) => set('dropoff_has_elevator', e.target.checked)}
                      style={{ width: 18, height: 18 }}
                    />
                    Van lift?
                  </label>
                )}
              </div>
              {form.dropoff_floor !== '0' && !form.dropoff_has_elevator && (
                <p style={{ fontSize: 12, color: '#FB8C00', marginTop: 8, marginBottom: 0 }}>
                  ⚠ Lépcsőn kell cipelni — a sofőrnek lényeges információ!
                </p>
              )}
            </div>
          )}
        </div>

        {/* --- Csomag adatai --- */}
        <h2 style={{ marginTop: 24 }}>Csomag adatai</h2>
        <p className="muted" style={{ fontSize: 13, marginTop: 0 }}>
          Kötelező – a sofőr ezek alapján dönti el, belefér-e a járművébe,
          és hogy a jármű össztömeg-korlátját nem lépi-e át.
        </p>
        <div className="grid-2">
          <div>
            <label>Hosszúság (cm) <span style={REQ}>*</span></label>
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
              style={missing(form.length_cm) ? redBorder : undefined}
            />
          </div>
          <div>
            <label>Szélesség (cm) <span style={REQ}>*</span></label>
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
              style={missing(form.width_cm) ? redBorder : undefined}
            />
          </div>
          <div>
            <label>Magasság (cm) <span style={REQ}>*</span></label>
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
              style={missing(form.height_cm) ? redBorder : undefined}
            />
          </div>
          <div>
            <label>Súly (kg) <span style={REQ}>*</span></label>
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
              style={missing(form.weight_kg) ? redBorder : undefined}
            />
          </div>
        </div>
        {volumeM3 != null && (
          <p className="muted" style={{ fontSize: 12, marginTop: 8 }}>
            Számolt térfogat: <strong>{volumeM3} m³</strong>
          </p>
        )}

        {/* --- Azonnali fuvar toggle --- */}
        <div
          style={{
            marginTop: 24,
            padding: 16,
            background: form.is_instant ? 'rgba(255,179,0,0.12)' : 'transparent',
            border: `2px solid ${form.is_instant ? '#FFB300' : 'var(--border)'}`,
            borderRadius: 8,
          }}
        >
          <div
            role="button"
            tabIndex={0}
            onClick={() => set('is_instant', !form.is_instant)}
            onKeyDown={(e) => e.key === 'Enter' && set('is_instant', !form.is_instant)}
            style={{
              display: 'flex',
              gap: 12,
              alignItems: 'center',
              cursor: 'pointer',
            }}
          >
            <input
              type="checkbox"
              checked={form.is_instant}
              onChange={(e) => set('is_instant', e.target.checked)}
              style={{ width: 20, height: 20, flexShrink: 0 }}
            />
            <strong style={{ fontSize: 15 }}>⚡ Azonnali fuvar (nincs licitálás)</strong>
          </div>
          <p className="muted" style={{ fontSize: 13, marginTop: 8, marginBottom: 0 }}>
            Fix áron adod fel, és az első sofőr, aki elvállalja, elviszi.
            Push értesítés megy minden közeli sofőrnek. Sürgős / városi
            last-mile eseteknek ideális.
          </p>
          {form.is_instant && (
            <div style={{ display: 'flex', gap: 12, marginTop: 12, flexWrap: 'wrap' }}>
              <div style={{ flex: '1 1 140px' }}>
                <label style={{ fontSize: 13 }}>Meddig érvényes (perc)</label>
                <input
                  className="input"
                  type="number"
                  min={5}
                  max={240}
                  value={form.instant_duration_minutes}
                  onChange={(e) =>
                    set(
                      'instant_duration_minutes',
                      e.target.value === '' ? '' : Number(e.target.value),
                    )
                  }
                />
              </div>
              <div style={{ flex: '1 1 140px' }}>
                <label style={{ fontSize: 13 }}>Push sugár (km)</label>
                <input
                  className="input"
                  type="number"
                  min={1}
                  max={100}
                  value={form.instant_radius_km}
                  onChange={(e) =>
                    set(
                      'instant_radius_km',
                      e.target.value === '' ? '' : Number(e.target.value),
                    )
                  }
                />
              </div>
            </div>
          )}
        </div>

        {/* --- Ár --- */}
        <h2 style={{ marginTop: 24 }}>
          {form.is_instant ? 'Fix fuvardíj (végleges)' : 'Javasolt fuvardíj'}
        </h2>
        <label>Összeg (Ft) <span style={REQ}>*</span></label>
        <input
          className="input"
          type="number"
          min={1}
          value={form.suggested_price_huf}
          onChange={(e) =>
            set('suggested_price_huf', e.target.value === '' ? '' : Number(e.target.value))
          }
          placeholder={form.is_instant ? 'pl. 12000 (ezt kapja kézhez a sofőr + jutalék)' : 'pl. 65000'}
          required
          style={missing(form.suggested_price_huf) ? redBorder : undefined}
        />
        {form.is_instant && (
          <p className="muted" style={{ fontSize: 12, marginTop: 4 }}>
            Azonnali fuvarnál NINCS alkudozás: ezt fogja látni minden közeli sofőr,
            és az első elfogadó nyer.
          </p>
        )}

        {/* --- Csomag értéke --- */}
        <h2 style={{ marginTop: 24 }}>Csomag értéke</h2>
        <label>Becsült érték (Ft)</label>
        <input
          className="input"
          type="number"
          min={0}
          value={form.declared_value_huf}
          onChange={(e) =>
            set('declared_value_huf', e.target.value === '' ? '' : Number(e.target.value))
          }
          placeholder="pl. 50000"
        />
        <p className="muted" style={{ fontSize: 12, marginTop: 4 }}>
          Opcionális, de ajánlott. A sofőr ez alapján méri fel a felelősségét:
          egy 500.000 Ft-os tárgy szállítása más hozzáállást igényel, mint egy
          5.000 Ft-osé. Vitás esetben ez az összeg az irányadó.
        </p>

        {/* --- Számlakérés --- */}
        <div style={{ marginTop: 16 }}>
          <label style={{ display: 'flex', gap: 10, alignItems: 'center', cursor: 'pointer' }}>
            <input type="checkbox" checked={form.invoice_requested}
              onChange={(e) => set('invoice_requested', e.target.checked)}
              style={{ width: 18, height: 18 }} />
            <span style={{ fontSize: 14 }}>Szamlat kerek errol a fuvarrol</span>
          </label>
          <p className="muted" style={{ fontSize: 12, marginTop: 4 }}>
            Ha szamlat kersz, a sofor a fuvar lezarasakor szamlat allit ki a teljes fuvardijrol.
          </p>
        </div>

        {error && <p style={{ color: 'var(--danger)', marginTop: 16 }}>{error}</p>}
        {uploadProgress && (
          <p className="muted" style={{ marginTop: 16 }}>{uploadProgress}</p>
        )}

        <button
          className="btn"
          type="submit"
          disabled={submitting}
          style={{ marginTop: 24 }}
        >
          {submitting
            ? (uploadProgress || 'Feladás...')
            : photos.length > 0
              ? `Fuvar feladása (${photos.length} fotó)`
              : 'Fuvar feladása'}
        </button>
      </form>
    </div>
  );
}
