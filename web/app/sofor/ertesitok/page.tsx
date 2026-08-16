'use client';

// Szállító útvonal-figyelők kezelése.
// A szállító beállít egy felvételi környéket (+ opcionális célt) sugárral, és
// új illeszkedő fuvarnál email + in-app értesítést kap (SMS nincs).
import { useEffect, useState } from 'react';
import { Bell, Plus, Trash2, MapPin, Flag } from 'lucide-react';
import { api, CarrierAlert } from '@/api';
import { useCurrentUser } from '@/lib/auth';
import { useToast } from '@/components/ToastProvider';
import { Loading, EmptyState } from '@/components/StateView';
import ConfirmDialog from '@/components/ConfirmDialog';
import AddressAutocomplete from '@/components/AddressAutocomplete';
import FieldError, { redBorder } from '@/components/FieldError';
import {
  sanitizeNumericInput, parseNumericInput, moneyFieldError, weightFieldError,
} from '@/lib/formValidation';

const RADIUS_OPTIONS = [10, 25, 50, 100];

export default function ErtesitokOldal() {
  const me = useCurrentUser();
  const toast = useToast();
  const [alerts, setAlerts] = useState<CarrierAlert[]>([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<CarrierAlert | null>(null);
  const [saving, setSaving] = useState(false);

  // Új figyelő űrlap állapot
  const [from, setFrom] = useState<{ label: string; lat: number; lng: number } | null>(null);
  const [to, setTo] = useState<{ label: string; lat: number; lng: number } | null>(null);
  const [fromText, setFromText] = useState('');
  const [toText, setToText] = useState('');
  const [radius, setRadius] = useState(25);
  const [minPrice, setMinPrice] = useState('');
  const [maxWeight, setMaxWeight] = useState('');
  // Mezőszintű hibák — a fuvarfeladással azonos megjelenítés (tesztelői
  // kérés, 2026-08-15): piros keret + a mező alatt konkrét magyarázat.
  // `probaltMenteni`: a hibákat csak az első mentési kísérlet UTÁN mutatjuk,
  // hogy ne piroslás fogadja a felhasználót, amint megnyitja az űrlapot.
  const [probaltMenteni, setProbaltMenteni] = useState(false);
  const [fromHiba, setFromHiba] = useState<string | null>(null);
  const [toHiba, setToHiba] = useState<string | null>(null);

  const arHiba = moneyFieldError(parseNumericInput(minPrice), { label: 'Minimum ár', required: false });
  // A max. súly OPCIONÁLIS itt (a `weightFieldError` alapból kötelezőnek
  // veszi), ezért üresen nem hibázunk — csak ha tényleg írt bele valamit.
  const sulyHiba = maxWeight.trim() === ''
    ? null
    : weightFieldError(parseNumericInput(maxWeight));
  const teruletHiba = !(from?.label || fromText).trim()
    ? 'Kérjük, töltsd ki: Felvételi környék.'
    : fromHiba;
  const mutat = (h: string | null) => (probaltMenteni ? h : null);

  async function load() {
    setLoading(true);
    try {
      setAlerts(await api.listCarrierAlerts());
    } catch (e: any) {
      toast.error('Hiba', e.message);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { if (me) load(); }, [me?.id]);

  function resetForm() {
    setFrom(null); setTo(null); setFromText(''); setToText('');
    setRadius(25); setMinPrice(''); setMaxWeight('');
  }

  async function createAlert() {
    // Elsődlegesen a listából választott koordináta; ha csak beírta a várost,
    // a szöveget küldjük, és a szerver geokódolja (kényelmi tartalék).
    const fromName = (from?.label || fromText).trim();
    const toName = (to?.label || toText).trim();

    // A hibákat mostantól MEZŐNKÉNT mutatjuk (piros keret + magyarázat), nem
    // csak egy eltűnő toastban — a felhasználó így látja, MELYIK mezőt kell
    // javítania. A toast megmarad másodlagos jelzésnek.
    setProbaltMenteni(true);
    if (!fromName || fromHiba || toHiba || arHiba || sulyHiba) {
      toast.error('Nézd át az űrlapot', 'Néhány mező javításra szorul — a hibás mezők pirosan keretezve.');
      return;
    }
    setSaving(true);
    try {
      const label = toName ? `${fromName} → ${toName}` : `${fromName} (${radius} km)`;
      await api.createCarrierAlert({
        label,
        from_lat: from?.lat ?? null, from_lng: from?.lng ?? null, from_label: fromName,
        to_lat: to?.lat ?? null, to_lng: to?.lng ?? null, to_label: toName || null,
        radius_km: radius,
        min_price_huf: parseNumericInput(minPrice) === '' ? null : Number(parseNumericInput(minPrice)),
        max_weight_kg: parseNumericInput(maxWeight) === '' ? null : Number(parseNumericInput(maxWeight)),
      } as any);
      toast.success('Figyelő létrehozva', 'Értesítünk, ha új illeszkedő fuvar érkezik.');
      resetForm();
      setShowForm(false);
      load();
    } catch (e: any) {
      toast.error('Nem sikerült', e.message);
    } finally {
      setSaving(false);
    }
  }

  async function toggle(a: CarrierAlert) {
    try {
      await api.setCarrierAlertActive(a.id, !a.active);
      setAlerts((prev) => prev.map((x) => (x.id === a.id ? { ...x, active: !x.active } : x)));
    } catch (e: any) {
      toast.error('Hiba', e.message);
    }
  }

  async function doDelete(a: CarrierAlert) {
    try {
      await api.deleteCarrierAlert(a.id);
      setAlerts((prev) => prev.filter((x) => x.id !== a.id));
      toast.info('Figyelő törölve');
    } catch (e: any) {
      toast.error('Hiba', e.message);
    }
  }

  if (!me) return <Loading />;

  return (
    <div style={{ maxWidth: 720, margin: '0 auto' }}>
      <div className="row" style={{ justifyContent: 'space-between', alignItems: 'center' }}>
        <div>
          <h1 style={{ marginBottom: 4, display: 'flex', alignItems: 'center', gap: 10 }}>
            <Bell size={26} color="var(--primary)" /> Útvonal-figyelők
          </h1>
          <p className="muted" style={{ margin: 0 }}>
            Állítsd be, milyen fuvarokra vársz — emailt és értesítést kapsz, amint új illeszkedő fuvar érkezik.
          </p>
        </div>
        {!showForm && (
          <button className="btn" onClick={() => setShowForm(true)}>
            <Plus size={18} /> Új figyelő
          </button>
        )}
      </div>

      {/* Új figyelő űrlap */}
      {showForm && (
        <div className="card" style={{ marginTop: 16 }}>
          <h2 style={{ marginTop: 0 }}>Új útvonal-figyelő</h2>
          {/* `requireArea`: legalább TELEPÜLÉS-szint kell — az ország vagy a
              megye nem elég (tesztelői észrevétel, 2026-08-15). Házszámot
              viszont NEM követelünk: a figyelő egy KÖRZETRE szól, ott a
              „Szeged" a helyes megadás. */}
          <AddressAutocomplete
            label="Felvételi környék *"
            value={fromText}
            requireArea
            onImprecise={(m) => setFromHiba(m || null)}
            onChange={(addr, lat, lng) => {
              setFrom({ label: addr, lat, lng }); setFromText(addr); setFromHiba(null);
            }}
            onTextChange={(t) => { setFromText(t); if (!t) { setFrom(null); setFromHiba(null); } }}
            placeholder="pl. Budapest, vagy egy konkrét cím"
          />
          <FieldError>{mutat(teruletHiba)}</FieldError>

          <AddressAutocomplete
            label="Célterület (opcionális)"
            value={toText}
            requireArea
            onImprecise={(m) => setToHiba(m || null)}
            onChange={(addr, lat, lng) => {
              setTo({ label: addr, lat, lng }); setToText(addr); setToHiba(null);
            }}
            onTextChange={(t) => { setToText(t); if (!t) { setTo(null); setToHiba(null); } }}
            placeholder="Hagyd üresen, ha bárhová mehet"
          />
          <FieldError>{mutat(toHiba)}</FieldError>

          <p className="muted" style={{ fontSize: 12, margin: '6px 0 0' }}>
            💡 Elég a település neve (pl. <strong>Eger</strong>) — házszám nem kell.
            Egy egész ország vagy megye viszont túl tág: minden fuvarra riasztást kapnál.
          </p>

          <label>Sugár a pont(ok) körül</label>
          <div className="row" style={{ gap: 8, marginTop: 4 }}>
            {RADIUS_OPTIONS.map((r) => (
              <button
                key={r}
                type="button"
                onClick={() => setRadius(r)}
                className={radius === r ? 'btn' : 'btn btn-ghost'}
                style={{ flex: 1, padding: '8px 0' }}
              >
                {r} km
              </button>
            ))}
          </div>

          <div className="grid-2" style={{ marginTop: 8 }}>
            <div>
              <label htmlFor="figyelo-min-ar">Minimum ár (Ft) — opcionális</label>
              {/* `sanitizeNumericInput`: a mínuszjel BE SEM ÍRHATÓ (tesztelői
                  észrevétel, 2026-08-15) — a `min` attribútum önmagában csak a
                  natív űrlap-ellenőrzéskor szólna, gépelés közben nem. */}
              <input
                id="figyelo-min-ar"
                className="input"
                type="number"
                inputMode="numeric"
                min={0}
                value={minPrice}
                onChange={(e) => setMinPrice(sanitizeNumericInput(e.target.value))}
                placeholder="pl. 10000"
                title="Csak ennél drágább fuvarokról értesítünk. Hagyd üresen, ha mindegy."
                style={mutat(arHiba) ? redBorder : undefined}
              />
              <FieldError>{mutat(arHiba)}</FieldError>
            </div>
            <div>
              <label htmlFor="figyelo-max-suly">Max. súly (kg) — opcionális</label>
              <input
                id="figyelo-max-suly"
                className="input"
                type="number"
                inputMode="numeric"
                min={0}
                value={maxWeight}
                onChange={(e) => setMaxWeight(sanitizeNumericInput(e.target.value))}
                placeholder="pl. 500"
                title="Csak ennél könnyebb csomagokról értesítünk. Hagyd üresen, ha mindegy."
                style={mutat(sulyHiba) ? redBorder : undefined}
              />
              <FieldError>{mutat(sulyHiba)}</FieldError>
            </div>
          </div>

          <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end', marginTop: 20 }}>
            <button className="btn btn-secondary" onClick={() => { resetForm(); setShowForm(false); }}>
              Mégse
            </button>
            <button className="btn" onClick={createAlert} disabled={saving || !(from || fromText.trim())}>
              {saving ? 'Mentés…' : 'Figyelő létrehozása'}
            </button>
          </div>
        </div>
      )}

      {/* Lista */}
      {loading ? (
        <Loading />
      ) : alerts.length === 0 && !showForm ? (
        <div style={{ marginTop: 16 }}>
          <EmptyState
            icon={<Bell size={28} aria-hidden />}
            title="Még nincs útvonal-figyelőd"
            description="Állíts be egyet, és nem maradsz le a számodra fontos fuvarokról — emailt és értesítést küldünk, amint új illeszkedő fuvar érkezik."
            cta={<button className="btn" onClick={() => setShowForm(true)}><Plus size={18} /> Első figyelő létrehozása</button>}
          />
        </div>
      ) : (
        <div style={{ marginTop: 16, display: 'flex', flexDirection: 'column', gap: 12 }}>
          {alerts.map((a) => (
            <div key={a.id} className="card" style={{ marginBottom: 0, opacity: a.active ? 1 : 0.6 }}>
              <div className="row" style={{ justifyContent: 'space-between', alignItems: 'start' }}>
                <div style={{ flex: 1 }}>
                  <div style={{ fontWeight: 700, marginBottom: 6 }}>{a.label || 'Útvonal-figyelő'}</div>
                  <div className="muted" style={{ fontSize: 13, display: 'flex', alignItems: 'center', gap: 6 }}>
                    <MapPin size={14} /> {a.from_label || 'Felvételi környék'} · {a.radius_km} km
                  </div>
                  {a.to_label && (
                    <div className="muted" style={{ fontSize: 13, display: 'flex', alignItems: 'center', gap: 6, marginTop: 2 }}>
                      <Flag size={14} /> {a.to_label}
                    </div>
                  )}
                  {(a.min_price_huf || a.max_weight_kg) && (
                    <div className="muted" style={{ fontSize: 12, marginTop: 4 }}>
                      {a.min_price_huf ? `Min. ${a.min_price_huf.toLocaleString('hu-HU')} Ft` : ''}
                      {a.min_price_huf && a.max_weight_kg ? ' · ' : ''}
                      {a.max_weight_kg ? `Max. ${a.max_weight_kg} kg` : ''}
                    </div>
                  )}
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                  <label style={{ display: 'flex', alignItems: 'center', gap: 6, margin: 0, cursor: 'pointer', fontSize: 12 }}>
                    <input type="checkbox" checked={a.active} onChange={() => toggle(a)} style={{ width: 'auto', margin: 0 }} />
                    {a.active ? 'Aktív' : 'Szünet'}
                  </label>
                  <button
                    type="button"
                    onClick={() => setDeleteTarget(a)}
                    aria-label="Törlés"
                    style={{ background: 'transparent', border: 'none', cursor: 'pointer', color: 'var(--danger-text)', padding: 6, display: 'flex' }}
                  >
                    <Trash2 size={18} />
                  </button>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      <ConfirmDialog
        open={!!deleteTarget}
        title="Figyelő törlése"
        message="Biztosan törlöd ezt az útvonal-figyelőt? Többé nem kapsz róla értesítést."
        confirmLabel="Törlöm"
        danger
        onConfirm={() => { if (deleteTarget) doDelete(deleteTarget); setDeleteTarget(null); }}
        onClose={() => setDeleteTarget(null)}
      />
    </div>
  );
}
