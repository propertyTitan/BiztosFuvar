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
import { useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { api } from '@/api';
import AddressAutocomplete from '@/components/AddressAutocomplete';
import { useToast } from '@/components/ToastProvider';
import { useCurrentUser } from '@/lib/auth';
import {
  MAX_DIM_CM, MAX_WEIGHT_KG,
  intFieldError, moneyFieldError, weightFieldError,
  sanitizeNumericInput, parseNumericInput, phoneError,
} from '@/lib/formValidation';

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
  /** „Nem én veszem át" — ilyenkor a címzett neve + telefonszáma KÖTELEZŐ. */
  other_recipient: boolean;
  recipient_name: string;
  recipient_phone: string;
  recipient_email: string;
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
  other_recipient: false,
  recipient_name: '',
  recipient_phone: '',
  recipient_email: '',
};

const REQ = { color: 'var(--danger-text)', fontWeight: 700 } as const;
const redBorder = { border: '2px solid var(--danger)', boxShadow: '0 0 0 3px rgba(239,68,68,0.15)' } as const;

/** Egy mező alatti piros hibaüzenet — csak akkor, ha van mit mondani. */
function FieldError({ children }: { children: string | null }) {
  if (!children) return null;
  return (
    <p role="alert" style={{ color: 'var(--danger-text)', fontSize: 12, margin: '4px 0 0' }}>
      {children}
    </p>
  );
}

export default function UjFuvar() {
  const router = useRouter();
  const toast = useToast();
  const me = useCurrentUser();
  const [mounted, setMounted] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [form, setForm] = useState<FormState>(initialForm);
  const [photos, setPhotos] = useState<File[]>([]);
  const [uploadProgress, setUploadProgress] = useState<string | null>(null);
  const [tried, setTried] = useState(false);
  // Cím-pontatlanság (csak várost/országot választott a legördülőből)
  const [pickupImprecise, setPickupImprecise] = useState('');
  const [dropoffImprecise, setDropoffImprecise] = useState('');
  // A szám-mezők NYERS szövege. Miért kell külön a `form` számai mellé:
  //  (1) a „12," köztes gépelési állapot ne tűnjön el a mezőből;
  //  (2) ha valaki egész mezőbe tizedest ír, azt LÁSSA és hibaüzenetet
  //      kapjon rá — ne csendben 12,5 cm-ből 125 cm legyen.
  type NumKey = 'length_cm' | 'width_cm' | 'height_cm' | 'weight_kg'
    | 'suggested_price_huf' | 'declared_value_huf';
  const [raw, setRaw] = useState<Record<NumKey, string>>({
    length_cm: '', width_cm: '', height_cm: '', weight_kg: '',
    suggested_price_huf: '', declared_value_huf: '',
  });

  /** Szám-mező onChange: szűrt nyers szöveg + belőle származtatott érték. */
  function setNumeric(key: NumKey, input: string) {
    const s = sanitizeNumericInput(input);
    setRaw((prev) => ({ ...prev, [key]: s }));
    setForm((prev) => ({ ...prev, [key]: parseNumericInput(s) }));
  }

  useEffect(() => { setMounted(true); }, []);

  function missing(filled: unknown): boolean {
    if (!tried) return false;
    if (typeof filled === 'string') return !filled.trim();
    if (typeof filled === 'number') return false;
    return !filled;
  }

  // --- Mezőnkénti hibák ---------------------------------------------------
  // Mindig kiszámoljuk (a submit-tiltáshoz kell), de csak submit-próba után
  // MUTATJUK meg — hogy ne kiabáljunk a userre gépelés közben.
  const errors = {
    title: form.title.trim() ? null : 'Kérjük, töltsd ki: Megnevezés.',
    length: intFieldError(form.length_cm, { label: 'Hosszúság (cm)', max: MAX_DIM_CM }),
    width: intFieldError(form.width_cm, { label: 'Szélesség (cm)', max: MAX_DIM_CM }),
    height: intFieldError(form.height_cm, { label: 'Magasság (cm)', max: MAX_DIM_CM }),
    weight: weightFieldError(form.weight_kg),
    price: moneyFieldError(form.suggested_price_huf, { label: 'Fuvardíj (Ft)' }),
    declared: moneyFieldError(form.declared_value_huf, {
      label: 'Becsült érték (Ft)', required: false, min: 0,
    }),
    recipientName: form.other_recipient && !form.recipient_name.trim()
      ? 'Kérjük, töltsd ki: Címzett neve.'
      : null,
    recipientPhone: form.other_recipient ? phoneError(form.recipient_phone) : null,
  };
  const show = (key: keyof typeof errors) => (tried ? errors[key] : null);

  // Előnézeti URL-ek a kiválasztott képekhez. Memoizáljuk, mert a URL.createObjectURL
  // memória-leak-et okozhat, ha minden renderre új URL-t generálunk.
  const photoPreviews = useMemo(
    () => photos.map((f) => ({ file: f, url: URL.createObjectURL(f) })),
    [photos],
  );

  function set<K extends keyof FormState>(key: K, value: FormState[K]) {
    setForm((prev) => ({ ...prev, [key]: value }));
  }

  // "Hozasd el" előtöltés: ha a /hozasd-el oldalról jött (sessionStorage),
  // a cím és a forrás-link előtöltődik, majd a kulcsot töröljük. A forrás-
  // boltot külön eltároljuk, hogy a fuvarra "Bolti átvétel" jelvény kerüljön.
  const [sourceStore, setSourceStore] = useState<string | null>(null);
  // "Hozasd el" termékkép — a hirdetés OG-előnézeti képe, a szállító ezt látja
  const [sourceImage, setSourceImage] = useState<string | null>(null);
  useEffect(() => {
    try {
      const raw = sessionStorage.getItem('gofuvar_prefill');
      if (!raw) return;
      sessionStorage.removeItem('gofuvar_prefill');
      const p = JSON.parse(raw);
      const KNOWN = ['IKEA', 'OBI', 'Praktiker', 'Jófogás'];
      if (KNOWN.includes(p.sourceName)) setSourceStore(p.sourceName);
      if (typeof p.image === 'string' && /^https:\/\//i.test(p.image)) setSourceImage(p.image);
      setForm((prev) => {
        const next = { ...prev };
        if (p.title && !prev.title) next.title = String(p.title).slice(0, 120);
        // A forrás-linket és a hirdetés-leírást a fuvar leírásába tesszük
        const parts: string[] = [];
        if (prev.description) parts.push(prev.description);
        if (p.description) parts.push(String(p.description).slice(0, 500));
        if (p.sourceUrl) parts.push(`Forrás (${p.sourceName || 'hirdetés'}): ${p.sourceUrl}`);
        if (parts.length) next.description = parts.join('\n\n');
        return next;
      });
    } catch {}
  }, []);

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
    Object.values(errors).every((e) => e === null) &&
    form.pickup_confirmed &&
    form.dropoff_confirmed;

  // --- Okos ár-tartomány ---
  // Amint a felvételi+lerakodási pont megvan és van súly+méret, lekérünk egy
  // ajánlott ársávot (táv + súly + csomagméret alapján). Ez horgony a feladónak,
  // hogy ne árazza alá → ne maradjon licit nélkül a fuvar. (Instant fuvarnál
  // is hasznos.) Debounce: ne lőjünk a backendre minden billentyűleütésre.
  const [estimate, setEstimate] = useState<{ low: number; high: number; mid: number } | null>(null);
  const haveEstimateInputs = Boolean(
    form.pickup_confirmed && form.dropoff_confirmed &&
    form.pickup_lat != null && form.dropoff_lat != null &&
    form.weight_kg && volumeM3,
  );

  useEffect(() => {
    if (!haveEstimateInputs) { setEstimate(null); return; }
    let cancelled = false;
    const t = setTimeout(async () => {
      try {
        const r = await api.priceEstimate({
          pickup_lat: Number(form.pickup_lat), pickup_lng: Number(form.pickup_lng),
          dropoff_lat: Number(form.dropoff_lat), dropoff_lng: Number(form.dropoff_lng),
          weight_kg: Number(form.weight_kg),
          volume_m3: volumeM3 || undefined,
          pickup_floor: Number(form.pickup_floor) || undefined,
          pickup_has_elevator: form.pickup_has_elevator,
          dropoff_floor: Number(form.dropoff_floor) || undefined,
          dropoff_has_elevator: form.dropoff_has_elevator,
        });
        if (!cancelled) setEstimate({ low: r.range_low_huf, high: r.range_high_huf, mid: r.estimate_huf });
      } catch {
        if (!cancelled) setEstimate(null);
      }
    }, 450);
    return () => { cancelled = true; clearTimeout(t); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    haveEstimateInputs, form.pickup_lat, form.pickup_lng, form.dropoff_lat, form.dropoff_lng,
    form.weight_kg, volumeM3, form.pickup_floor, form.pickup_has_elevator,
    form.dropoff_floor, form.dropoff_has_elevator,
  ]);

  // Alulárazás: a beírt ár jóval (>15%) a javasolt sáv alja alatt van
  const priceNum = form.suggested_price_huf === '' ? null : Number(form.suggested_price_huf);
  const underpriced = Boolean(estimate && priceNum != null && priceNum > 0 && priceNum < estimate.low * 0.85);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setTried(true);
    if (!canSubmit) {
      // A konkrét okot mondjuk meg, ne csak azt, hogy „valami hiányzik".
      const firstProblem =
        Object.values(errors).find((e) => e !== null) ||
        (!form.pickup_confirmed
          ? 'A felvétel helyét válaszd ki a legördülő listából, házszámmal együtt.'
          : null) ||
        (!form.dropoff_confirmed
          ? 'A lerakodás helyét válaszd ki a legördülő listából, házszámmal együtt.'
          : null);
      toast.error('Hiányzó vagy hibás mező', firstProblem || 'Nézd át a pirossal jelölt mezőket.');
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
        ...(form.recipient_name ? { recipient_name: form.recipient_name } : {}),
        ...(form.recipient_phone ? { recipient_phone: form.recipient_phone } : {}),
        ...(form.recipient_email ? { recipient_email: form.recipient_email } : {}),
        ...(sourceStore ? { source_store: sourceStore } : {}),
        ...(sourceImage ? { source_image_url: sourceImage } : {}),
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

  // --- Belépés-kapu -------------------------------------------------------
  // A useCurrentUser az első renderen mindig null-t ad (localStorage-olvasás
  // a useEffect-ben) — ezért előbb a mounted flaget várjuk meg, különben
  // minden belépett usert is kidobnánk.
  if (!mounted) {
    return (
      <div style={{ padding: '32px 16px', textAlign: 'center', color: 'var(--muted)' }}>
        Betöltés…
      </div>
    );
  }
  if (!me) {
    router.push('/bejelentkezes');
    return null;
  }

  return (
    <div style={{ maxWidth: 720 }}>
      <h1>Új fuvar feladása</h1>
      <p className="muted">
        Add meg a fuvar adatait. A cím automatikusan kiegészíthető térképről,
        és az AI ellenőrzi a leírást.
      </p>

      {/* noValidate: a natív böngésző-buborék („Please fill out this field")
          a böngésző nyelvén szól, és megállítja a submitot MIELŐTT a saját,
          konkrétabb magyar üzeneteink megjelenhetnének. A `required` a
          mezőkön marad (akadálymentesség), de a validációt mi vezetjük. */}
      <form
        className="card"
        onSubmit={onSubmit}
        noValidate
        // Enter egy szövegmezőben NE küldje el az űrlapot: a cím-
        // autocomplete legördülőjéből Enterrel választani természetes
        // mozdulat, és korábban ilyenkor a fél űrlap kipirosodott.
        // A feladás a gombbal megy (a textarea sortörése érintetlen).
        onKeyDown={(e) => {
          const el = e.target as HTMLElement;
          if (e.key === 'Enter' && el.tagName === 'INPUT' && (el as HTMLInputElement).type !== 'checkbox') {
            e.preventDefault();
          }
        }}
      >
        <label htmlFor="uj-cim">Megnevezés <span style={REQ}>*</span></label>
        <input
          id="uj-cim"
          className="input"
          value={form.title}
          onChange={(e) => set('title', e.target.value)}
          placeholder="Pl. Költöztetés Budapest → Debrecen"
          required
          style={show('title') ? redBorder : undefined}
        />
        <FieldError>{show('title')}</FieldError>

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
          Opcionális, de erősen ajánlott. A szállítók pontosabb ajánlatot adnak,
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
          label="Pontos cím utcával és házszámmal (válassz a legördülő listából)"
          placeholder="pl. Budapest, Váci út 1."
          value={form.pickup_address}
          requirePrecise
          onImprecise={setPickupImprecise}
          onChange={(addr, lat, lng) => {
            setPickupImprecise('');
            setForm((f) => ({
              ...f,
              pickup_address: addr,
              pickup_lat: lat,
              pickup_lng: lng,
              pickup_confirmed: true,
            }));
          }}
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
        {pickupImprecise && (
          <p role="alert" style={{ color: 'var(--danger-text)', fontSize: 12, marginTop: 6 }}>
            {pickupImprecise}
          </p>
        )}
        {!form.pickup_confirmed && form.pickup_address && !pickupImprecise && (
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
              A szállítónak be kell pakolnia a csomagot a felvételi helyen?
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
                  ⚠ Lépcsőn kell cipelni — a szállítónak lényeges információ!
                </p>
              )}
            </div>
          )}
        </div>

        {/* --- Lerakodás --- */}
        <h2 style={{ marginTop: 24 }}>Lerakodás helye <span style={REQ}>*</span></h2>
        <div style={missing(form.dropoff_confirmed ? 'ok' : '') ? { ...redBorder, borderRadius: 8, padding: 2 } : undefined}>
        <AddressAutocomplete
          label="Pontos cím utcával és házszámmal (válassz a legördülő listából)"
          placeholder="pl. Szeged, Kossuth Lajos sugárút 1."
          value={form.dropoff_address}
          requirePrecise
          onImprecise={setDropoffImprecise}
          onChange={(addr, lat, lng) => {
            setDropoffImprecise('');
            setForm((f) => ({
              ...f,
              dropoff_address: addr,
              dropoff_lat: lat,
              dropoff_lng: lng,
              dropoff_confirmed: true,
            }));
          }}
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
        {dropoffImprecise && (
          <p role="alert" style={{ color: 'var(--danger-text)', fontSize: 12, marginTop: 6 }}>
            {dropoffImprecise}
          </p>
        )}
        {!form.dropoff_confirmed && form.dropoff_address && !dropoffImprecise && (
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
              A szállítónak fel kell vinnie a csomagot a lerakodási helyen?
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
                  ⚠ Lépcsőn kell cipelni — a szállítónak lényeges információ!
                </p>
              )}
            </div>
          )}
        </div>

        {/* --- Csomag adatai --- */}
        <h2 style={{ marginTop: 24 }}>Csomag adatai</h2>
        <p className="muted" style={{ fontSize: 13, marginTop: 0 }}>
          Kötelező – a szállító ezek alapján dönti el, belefér-e a járművébe,
          és hogy a jármű össztömeg-korlátját nem lépi-e át. A méreteket
          <strong> egész centiméterben</strong> add meg (tört és negatív érték
          nem adható meg); a súly lehet tizedes (pl. 12,5 kg).
        </p>
        <div className="grid-2">
          <div>
            <label htmlFor="uj-hossz">Hosszúság (cm) <span style={REQ}>*</span></label>
            <input
              id="uj-hossz"
              className="input"
              // type="text" + inputMode: a mínuszjel és a tizedespont így be
              // sem írható (a type="number" a köztes „12-” / „12.” állapotra
              // ÜRES value-t ad, ami kitörölné a mezőt gépelés közben).
              type="text"
              inputMode="numeric"
              title={`Egész szám centiméterben, 1 és ${MAX_DIM_CM} között. Tört és negatív érték nem adható meg.`}
              value={raw.length_cm}
              onChange={(e) => setNumeric('length_cm', e.target.value)}
              placeholder="pl. 120"
              required
              style={show('length') ? redBorder : undefined}
            />
            <FieldError>{show('length')}</FieldError>
          </div>
          <div>
            <label htmlFor="uj-szelesseg">Szélesség (cm) <span style={REQ}>*</span></label>
            <input
              id="uj-szelesseg"
              className="input"
              // type="text" + inputMode: a mínuszjel és a tizedespont így be
              // sem írható (a type="number" a köztes „12-” / „12.” állapotra
              // ÜRES value-t ad, ami kitörölné a mezőt gépelés közben).
              type="text"
              inputMode="numeric"
              title={`Egész szám centiméterben, 1 és ${MAX_DIM_CM} között. Tört és negatív érték nem adható meg.`}
              value={raw.width_cm}
              onChange={(e) => setNumeric('width_cm', e.target.value)}
              placeholder="pl. 80"
              required
              style={show('width') ? redBorder : undefined}
            />
            <FieldError>{show('width')}</FieldError>
          </div>
          <div>
            <label htmlFor="uj-magassag">Magasság (cm) <span style={REQ}>*</span></label>
            <input
              id="uj-magassag"
              className="input"
              // type="text" + inputMode: a mínuszjel és a tizedespont így be
              // sem írható (a type="number" a köztes „12-” / „12.” állapotra
              // ÜRES value-t ad, ami kitörölné a mezőt gépelés közben).
              type="text"
              inputMode="numeric"
              title={`Egész szám centiméterben, 1 és ${MAX_DIM_CM} között. Tört és negatív érték nem adható meg.`}
              value={raw.height_cm}
              onChange={(e) => setNumeric('height_cm', e.target.value)}
              placeholder="pl. 100"
              required
              style={show('height') ? redBorder : undefined}
            />
            <FieldError>{show('height')}</FieldError>
          </div>
          <div>
            <label htmlFor="uj-suly">Súly (kg) <span style={REQ}>*</span></label>
            <input
              id="uj-suly"
              className="input"
              type="text"
              inputMode="decimal"
              title={`0-nál nagyobb súly kilogrammban, legfeljebb ${MAX_WEIGHT_KG.toLocaleString('hu-HU')} kg. Tizedes érték megengedett (pl. 12,5), negatív nem.`}
              value={raw.weight_kg}
              onChange={(e) => setNumeric('weight_kg', e.target.value)}
              placeholder="pl. 350"
              required
              style={show('weight') ? redBorder : undefined}
            />
            <FieldError>{show('weight')}</FieldError>
          </div>
        </div>
        {volumeM3 != null && (
          <p className="muted" style={{ fontSize: 12, marginTop: 8 }}>
            Számolt térfogat: <strong>{volumeM3} m³</strong>
          </p>
        )}

        {/* --- Azonnali fuvar toggle — IDEIGLENESEN KIKAPCSOLVA (100+ szállító után visszakapcsolni) ---
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
            <strong style={{ fontSize: 16 }}>⚡ Azonnali fuvar (nincs ajánlattétel)</strong>
          </div>
          <p className="muted" style={{ fontSize: 13, marginTop: 8, marginBottom: 0 }}>
            Fix áron adod fel, és az első szállító, aki elvállalja, elviszi.
            Push értesítés megy minden közeli szállítónak. Sürgős / városi
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
        --- */}

        {/* --- Ár --- */}
        <h2 style={{ marginTop: 24 }}>
          {form.is_instant ? 'Fix fuvardíj (végleges)' : 'Javasolt fuvardíj'}
        </h2>
        <label htmlFor="uj-ar">Összeg (Ft) <span style={REQ}>*</span></label>
        <input
          id="uj-ar"
          className="input"
          type="text"
          inputMode="numeric"
          title="Kerek forintösszeg. Negatív és tört (filléres) érték nem adható meg."
          value={raw.suggested_price_huf}
          onChange={(e) => setNumeric('suggested_price_huf', e.target.value)}
          placeholder={form.is_instant ? 'pl. 12000 (a szállító készpénzben, levonás nélkül kapja)' : 'pl. 65000'}
          required
          style={show('price') ? redBorder : undefined}
        />
        <FieldError>{show('price')}</FieldError>

        {/* Okos ár-tartomány — horgony a feladónak */}
        {estimate && (
          <div className="callout callout-info" style={{ marginTop: 10, padding: 14 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
              <span style={{ fontSize: 18 }}>💡</span>
              <span style={{ fontSize: 14 }}>
                Ajánlott ársáv: <strong>{estimate.low.toLocaleString('hu-HU')} – {estimate.high.toLocaleString('hu-HU')} Ft</strong>
              </span>
              <button
                type="button"
                className="btn btn-ghost"
                style={{ fontSize: 12, padding: '4px 10px', marginLeft: 'auto' }}
                onClick={() => set('suggested_price_huf', estimate.mid)}
              >
                Beírom a javasoltat
              </button>
            </div>
            <p className="muted" style={{ fontSize: 12, margin: '6px 0 0' }}>
              Becslés a táv, súly és csomagméret alapján. A végső árat a szállítók ajánlatai alakítják.
            </p>
          </div>
        )}

        {/* Alulárazás-figyelmeztetés */}
        {underpriced && (
          <div className="callout callout-warning" style={{ marginTop: 8, padding: '10px 14px' }}>
            <span style={{ fontSize: 14 }}>
              ⚠️ Ez alacsonynak tűnik a javasolt sávhoz képest — könnyen lehet, hogy kevés vagy egy ajánlat sem érkezik rá.
            </span>
          </div>
        )}

        {form.is_instant && (
          <p className="muted" style={{ fontSize: 12, marginTop: 4 }}>
            Azonnali fuvarnál NINCS alkudozás: ezt fogja látni minden közeli szállító,
            és az első elfogadó nyer.
          </p>
        )}

        {/* --- Csomag értéke --- */}
        <h2 style={{ marginTop: 24 }}>Csomag értéke</h2>
        <label>Becsült érték (Ft)</label>
        <input
          className="input"
          type="text"
          inputMode="numeric"
          title="Kerek forintösszeg. Negatív és tört (filléres) érték nem adható meg."
          value={raw.declared_value_huf}
          onChange={(e) => setNumeric('declared_value_huf', e.target.value)}
          placeholder="pl. 50000"
          style={show('declared') ? redBorder : undefined}
        />
        <FieldError>{show('declared')}</FieldError>
        <p className="muted" style={{ fontSize: 12, marginTop: 4 }}>
          Opcionális, de ajánlott. A szállító ez alapján méri fel a felelősségét:
          egy 500.000 Ft-os tárgy szállítása más hozzáállást igényel, mint egy
          5.000 Ft-osé. Vitás esetben ez az összeg az irányadó.
        </p>

        {/* --- Számlakérés --- */}
        <div style={{ marginTop: 16 }}>
          <label style={{ display: 'flex', gap: 10, alignItems: 'center', cursor: 'pointer' }}>
            <input type="checkbox" checked={form.invoice_requested}
              onChange={(e) => set('invoice_requested', e.target.checked)}
              style={{ width: 18, height: 18 }} />
            <span style={{ fontSize: 14 }}>Számlát kérek erről a fuvarról</span>
          </label>
          <p className="muted" style={{ fontSize: 12, marginTop: 4 }}>
            Ha számlát kérsz, a szállító a fuvar lezárásakor számlát állít ki a teljes fuvardíjról.
          </p>
        </div>

        {/* --- Címzett adatai --- */}
        <h2 style={{ marginTop: 24 }}>Átvétel</h2>
        <label style={{ display: 'flex', gap: 10, alignItems: 'center', cursor: 'pointer' }}>
          <input
            type="checkbox"
            checked={form.other_recipient}
            onChange={(e) => {
              const on = e.target.checked;
              setForm((f) => ({
                ...f,
                other_recipient: on,
                // kikapcsoláskor ne maradjon bent egy félig kitöltött címzett
                ...(on ? {} : { recipient_name: '', recipient_phone: '', recipient_email: '' }),
              }));
            }}
            style={{ width: 18, height: 18 }}
          />
          <span style={{ fontSize: 14 }}>
            <strong>Nem én veszem át a csomagot</strong> — más címzett veszi át
          </span>
        </label>

        {form.other_recipient && (
          <div
            style={{
              marginTop: 12,
              marginLeft: 28,
              padding: 12,
              border: '1px solid var(--border)',
              borderRadius: 8,
            }}
          >
            <p className="muted" style={{ fontSize: 13, marginTop: 0 }}>
              A címzett neve és telefonszáma <strong>kötelező</strong>: a szállítónak
              tudnia kell, kit keressen és kit hívhat, ha nem talál senkit a címen.
              A címzett SMS-t kap a felvételkor az átvételi kóddal.
            </p>
            <div className="grid-2">
              <div>
                <label htmlFor="uj-cimzett-nev">Címzett neve <span style={REQ}>*</span></label>
                <input
                  id="uj-cimzett-nev"
                  className="input"
                  autoComplete="name"
                  value={form.recipient_name}
                  onChange={(e) => set('recipient_name', e.target.value)}
                  placeholder="pl. Kiss Anna"
                  required
                  style={show('recipientName') ? redBorder : undefined}
                />
                <FieldError>{show('recipientName')}</FieldError>
              </div>
              <div>
                <label htmlFor="uj-cimzett-tel">Címzett telefonszáma <span style={REQ}>*</span></label>
                <input
                  id="uj-cimzett-tel"
                  className="input"
                  type="tel"
                  autoComplete="tel"
                  title="A szállító ezen a számon éri el a címzettet. Nemzetközi formátum is jó: +36 30 123 4567"
                  value={form.recipient_phone}
                  onChange={(e) => set('recipient_phone', e.target.value)}
                  placeholder="+36 30 123 4567"
                  required
                  style={show('recipientPhone') ? redBorder : undefined}
                />
                <FieldError>{show('recipientPhone')}</FieldError>
              </div>
            </div>
            <div>
              <label htmlFor="uj-cimzett-email">Címzett email (opcionális)</label>
              <input
                id="uj-cimzett-email"
                className="input"
                type="email"
                autoComplete="email"
                value={form.recipient_email}
                onChange={(e) => set('recipient_email', e.target.value)}
                placeholder="anna@email.hu"
              />
              <p className="muted" style={{ fontSize: 12, marginTop: 4 }}>
                Ha megadod, a címzett emailben is kapja a követési linket.
              </p>
            </div>
          </div>
        )}

        {error && <p style={{ color: 'var(--danger-text)', marginTop: 16 }}>{error}</p>}
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
