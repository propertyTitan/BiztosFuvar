'use client';

// Szállító kezdőoldal: elérhető (licitálható) fuvarok listája.
// - Közelség szerint rendezve, ha a böngésző megadja a geolocation-t.
// - Új fuvar érkezéskor (Socket.IO `jobs:new`) automatikusan frissül a lista.
// - Minden kártya → a fuvar részletes oldalára visz, ahol licitálni lehet.
// - Lista / térkép toggle: a user eldöntheti melyik nézetben böngészik.
//
// UX-review Q14 (2026-10-08): mobilon az első fuvar ~620 px-nél kezdődött,
// előtte hat vezérlősor állt (Értesíts, Új hirdetés — feladói művelet!,
// Lista/Térkép, Frissítés, GPS-sáv, Szűrők). Most EGY eszközsor: [Szűrők (n)]
// [Lista|Térkép] [Helyem]. A lista socketen magától frissül, de új fuvarnál
// nem ugrik el a szállító ujja alól: „N új fuvar – mutasd” pirula jelenik
// meg. Az „Értesíts” a lista végére és az üres állapotba került; a szűrt
// keresés üres állapota a szűrőkről szól. A halott „Típus/Azonnali” szűrő
// rejtve (az azonnali fuvar ki van kapcsolva).
import { useCallback, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { api, Job } from '@/api';
import { useCurrentUser } from '@/lib/auth';
import { ListSkeleton, EmptyState } from '@/components/StateView';
import { JARAT_ENGEDELYEZVE } from '@/lib/features';
import { mentPiszkozat, olvasPiszkozat } from '@/lib/urlapPiszkozat';
import {
  PackageSearch, SlidersHorizontal, List as ListIcon, Map as MapIcon, LocateFixed, MapPin, Flag, Lock, Bell, ArrowUp,
  Zap, ShoppingBag, Package,
} from 'lucide-react';
import TerkepJelmagyarazat, { TERKEP_SZINEK } from '@/components/TerkepJelmagyarazat';
import { subscribeFeed } from '@/lib/socket';
import JobBrowseMap from '@/components/JobBrowseMap';
import GreenBadge from '@/components/GreenBadge';
import SegmentedControl from '@/components/SegmentedControl';
import { useTranslation, formatPrice } from '@/lib/i18n';
import {
  type Filters, EMPTY_FILTERS, AZONNALI_ELERHETO, aktivSzurokSzama, figyeloLink,
} from './fuvarSzurok';
import { mertek } from '@/lib/mertek';

type ListedJob = Job & { distance_to_pickup_km?: number };
type ViewMode = 'list' | 'map';
type Search = { lat?: number; lng?: number; filters: Filters };

export default function SoforFuvarokLista() {
  const me = useCurrentUser();
  const router = useRouter();
  const { t } = useTranslation();
  const [jobs, setJobs] = useState<ListedJob[]>([]);
  const jobsRef = useRef<ListedJob[]>([]);
  jobsRef.current = jobs;
  // Háttérben (socketen) érkezett frissebb lista — csak a pirulára kattintva
  // cseréljük, hogy a lista ne ugorjon el a szállító ujja alól.
  const [fuggoLista, setFuggoLista] = useState<{ jobs: ListedJob[]; ujDb: number } | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const appliedSearch = useRef<Search>({ filters: EMPTY_FILTERS });
  const requestNumber = useRef(0);
  const [here, setHere] = useState<{ lat: number; lng: number } | null>(null);
  const [view, setView] = useState<ViewMode>('list');
  // Szűrők
  const [filterMinPrice, setFilterMinPrice] = useState('');
  const [filterMaxPrice, setFilterMaxPrice] = useState('');
  const [filterMaxWeight, setFilterMaxWeight] = useState('');
  const [filterFromCity, setFilterFromCity] = useState('');
  const [filterToCity, setFilterToCity] = useState('');
  // '' = mind, 'true' = csak azonnali, 'false' = csak ajánlatkérős
  const [filterType, setFilterType] = useState<'' | 'true' | 'false'>('');
  const [showFilters, setShowFilters] = useState(false);
  // Helymeghatározás állapota (2026-09-11, C2): a böngésző eddig magyarázat
  // nélkül, betöltéskor kérte a GPS-t — a felhasználó nem tudta, mire kell,
  // és sokan elutasították. Most: ha korábban már engedélyezte, csendben
  // használjuk; különben egy sáv magyarázza el, és GOMBRA kérjük.
  const [helyAllapot, setHelyAllapot] = useState<'ismeretlen' | 'keres' | 'megvan' | 'nincs'>('ismeretlen');
  const SZUROK_KULCS = 'gofuvar_fuvarok_szurok';
  // Éppen melyik instant fuvart próbáljuk elvállalni (race-prevent UI)
  const [acceptingInstantId, setAcceptingInstantId] = useState<string | null>(null);
  const [instantError, setInstantError] = useState<string | null>(null);

  async function acceptInstant(jobId: string, priceHuf: number, termsRevision?: number) {
    if (acceptingInstantId) return;
    setAcceptingInstantId(jobId);
    setInstantError(null);
    try {
      const res = await api.acceptInstantJob(jobId, priceHuf, termsRevision);
      // Siker → vigyük a fuvar részletek oldalra, ahol a feladó fizethet
      // (a szállító szempontjából: várakozás kifizetésre).
      router.push(`/sofor/fuvar/${res.job_id}`);
    } catch (err: any) {
      setInstantError(err.message);
      // Frissítsük a listát: nagy eséllyel valaki megelőzött, így az
      // instant fuvar eltűnik a listáról a következő load-kor.
      await refresh(appliedSearch.current);
    } finally {
      setAcceptingInstantId(null);
    }
  }

  // A szerver szűr és rendez. Későn beérkező régi keresés nem írhatja felül
  // az újabbat, a háttérfrissítés pedig nem tünteti el a látható listát.
  const refresh = useCallback(async ({ lat, lng, filters }: Search, background = false) => {
    const currentRequest = ++requestNumber.current;
    if (!background) setLoading(true);
    try {
      const { min, max, weight, from, to, type } = filters;
      const data = await api.listJobs({
        status: 'bidding',
        lat,
        lng,
        radius_km: lat != null ? 500 : undefined,
        min_price: min ? Number(min) : undefined,
        max_price: max ? Number(max) : undefined,
        max_weight_kg: weight ? Number(weight) : undefined,
        pickup_city: from || undefined,
        dropoff_city: to || undefined,
        instant: (AZONNALI_ELERHETO && type) || undefined,
      });
      if (currentRequest !== requestNumber.current) return;
      const ismert = new Set(jobsRef.current.map((j) => j.id));
      const ujDb = data.filter((j) => !ismert.has(j.id)).length;
      if (background && ujDb > 0 && jobsRef.current.length > 0) {
        setFuggoLista({ jobs: data, ujDb });
      } else {
        setJobs(data);
        if (!background) setFuggoLista(null);
      }
      setError(null);
    } catch (err: any) {
      if (currentRequest === requestNumber.current) setError(err.message);
    } finally {
      if (currentRequest === requestNumber.current) setLoading(false);
    }
  }, []);

  async function load(lat?: number, lng?: number, filters?: Filters) {
    const search = { lat, lng, filters: filters || {
      min: filterMinPrice, max: filterMaxPrice, weight: filterMaxWeight,
      from: filterFromCity, to: filterToCity, type: filterType,
    } };
    appliedSearch.current = search;
    await refresh(search);
  }

  // Indulás: próbáljuk meg megkérni a böngésző GPS-ét, ha nem megy / nem ad
  // engedélyt, egyszerűen az összes nyitott fuvart betöltjük.
  function helyetKer(csendben = false) {
    if (typeof window === 'undefined' || !navigator.geolocation) { setHelyAllapot('nincs'); return; }
    setHelyAllapot('keres');
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        const coords = { lat: pos.coords.latitude, lng: pos.coords.longitude };
        setHere(coords);
        setHelyAllapot('megvan');
        appliedSearch.current = { ...appliedSearch.current, ...coords };
        void refresh(appliedSearch.current);
      },
      () => { setHelyAllapot('nincs'); if (!csendben) void refresh(appliedSearch.current); },
      { timeout: 6000 },
    );
  }

  useEffect(() => {
    // Mentett szűrők visszaállítása (C2) — a lista MINDIG betöltődik, GPS
    // nélkül is; a helyet csak akkor kérjük automatikusan, ha már engedélyezett.
    const mentett = olvasPiszkozat<{ min: string; max: string; weight: string; from: string; to: string; type: '' | 'true' | 'false' }>(SZUROK_KULCS, 30 * 24 * 3600 * 1000);
    if (mentett) {
      setFilterMinPrice(mentett.min || ''); setFilterMaxPrice(mentett.max || ''); setFilterMaxWeight(mentett.weight || '');
      setFilterFromCity(mentett.from || ''); setFilterToCity(mentett.to || ''); setFilterType(mentett.type || '');
      if (mentett.min || mentett.max || mentett.weight || mentett.from || mentett.to || mentett.type) setShowFilters(true);
    }
    load(undefined, undefined, mentett || undefined);
    if (typeof navigator !== 'undefined' && navigator.permissions?.query) {
      navigator.permissions.query({ name: 'geolocation' as PermissionName })
        .then((st) => { if (st.state === 'granted') helyetKer(true); })
        .catch(() => {});
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    mentPiszkozat(SZUROK_KULCS, { min: filterMinPrice, max: filterMaxPrice, weight: filterMaxWeight, from: filterFromCity, to: filterToCity, type: filterType });
  }, [filterMinPrice, filterMaxPrice, filterMaxWeight, filterFromCity, filterToCity, filterType]);

  // Eseménycsomagonként egy lekérés, az utoljára ALKALMAZOTT szűrőkkel.
  // Az esemény adatai önmagukban nem tartalmazzák a keresés/rendezés eredményét.
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const scheduleRefresh = () => {
      if (timer) return;
      timer = setTimeout(() => {
        timer = undefined;
        void refresh(appliedSearch.current, true);
      }, 250);
    };
    const unsubscribe = subscribeFeed({
      'jobs:new': scheduleRefresh,
      'jobs:instant-taken': (payload: { job_id: string }) => {
        // Egy korábban elindult lista-válasz se hozhassa vissza az elvállalt fuvart.
        requestNumber.current++;
        setJobs((prev) => prev.filter((j) => j.id !== payload.job_id));
        setFuggoLista((f) => (f ? { ...f, jobs: f.jobs.filter((j) => j.id !== payload.job_id) } : f));
        scheduleRefresh();
      },
    });
    return () => {
      unsubscribe();
      clearTimeout(timer);
      requestNumber.current++;
    };
  }, [refresh]);

  const jelenlegiSzurok: Filters = {
    min: filterMinPrice, max: filterMaxPrice, weight: filterMaxWeight,
    from: filterFromCity, to: filterToCity, type: filterType,
  };
  const szuroDb = aktivSzurokSzama(appliedSearch.current.filters);
  function szurokTorlese() {
    setFilterMinPrice('');
    setFilterMaxPrice('');
    setFilterMaxWeight('');
    setFilterFromCity('');
    setFilterToCity('');
    setFilterType('');
    load(here?.lat, here?.lng, { ...EMPTY_FILTERS });
  }
  return (
    <div>
      <div>
        <h1 style={{ marginBottom: 4 }}>{t('jobs.title')}</h1>
        <p className="muted" style={{ margin: 0 }}>
          {here
            ? 'Közelség szerint rendezve a jelenlegi pozíciódhoz.'
            : helyAllapot === 'nincs'
              ? 'Az összes nyitott fuvar, a legfrissebb elöl. (A helymeghatározás nincs engedélyezve.)'
              : 'Az összes nyitott fuvar, a legfrissebb elöl. A „Helyem” gombbal a közeliek kerülnek előre — a helyzetedet csak a távolsághoz használjuk, nem tároljuk.'}
        </p>
      </div>

      {/* EGY eszközsor: szűrők · nézet · hely */}
      <div className="row" style={{ marginTop: 12, gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
        <button
          type="button"
          className="btn btn-secondary"
          aria-expanded={showFilters}
          aria-controls="fuvar-szurok"
          onClick={() => setShowFilters((v) => !v)}
          style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 13, padding: '8px 14px', minHeight: 40 }}
        >
          <SlidersHorizontal size={16} aria-hidden /> {szuroDb > 0 ? `Szűrők (${szuroDb})` : 'Szűrők'}
        </button>
        {/* UX A29: rádiócsoport — a kiválasztott nézet hallható, nyilakkal váltható. */}
        <SegmentedControl
          ariaLabel="Nézet"
          valtozat="pirula"
          ertek={view}
          onValtozas={setView}
          opciok={[
            { ertek: 'list', felirat: 'Lista', ikon: <ListIcon size={15} aria-hidden /> },
            { ertek: 'map', felirat: 'Térkép', ikon: <MapIcon size={15} aria-hidden /> },
          ]}
        />
        <button
          type="button"
          className="btn btn-secondary"
          onClick={() => helyetKer(false)}
          disabled={helyAllapot === 'keres'}
          aria-pressed={helyAllapot === 'megvan'}
          title="Közeli fuvarok elöl — a helyzetedet csak a távolság kiszámításához használjuk, nem tároljuk."
          style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 13, padding: '8px 14px', minHeight: 40 }}
        >
          {/* Keskeny képernyőn (≤420 px) csak az ikon látszik, a felirat a
              képernyőolvasónak megmarad — 390 px-en a gomb különben a
              második sorba tört (fix2-review, Q13). */}
          <LocateFixed size={16} aria-hidden />
          <span className="eszkozsor-felirat">{helyAllapot === 'keres' ? 'Keresés…' : 'Helyem'}</span>
        </button>
      </div>

      {fuggoLista && fuggoLista.ujDb > 0 && (
        <div style={{ display: 'flex', justifyContent: 'center', marginTop: 12 }}>
          <button
            type="button"
            className="btn"
            onClick={() => {
              setJobs(fuggoLista.jobs);
              setFuggoLista(null);
              if (typeof window !== 'undefined') window.scrollTo?.({ top: 0, behavior: 'smooth' });
            }}
            style={{ borderRadius: 999, fontSize: 13, padding: '8px 16px', display: 'inline-flex', alignItems: 'center', gap: 6 }}
          >
            <ArrowUp size={15} aria-hidden /> {fuggoLista.ujDb} új fuvar – mutasd
          </button>
        </div>
      )}

      {/* Szűrő-panel */}
      <div id="fuvar-szurok">
        {showFilters && (
          <div className="card" style={{ marginTop: 8, padding: 16 }}>
            <div className="row" style={{ gap: 12, flexWrap: 'wrap', alignItems: 'end' }}>
              <div>
                <label htmlFor="szuro-honnan" style={{ fontSize: 12 }}>Honnan (város)</label>
                <input
                  id="szuro-honnan"
                  className="input"
                  type="text"
                  value={filterFromCity}
                  onChange={(e) => setFilterFromCity(e.target.value)}
                  placeholder="pl. Budapest"
                  style={{ width: 140 }}
                />
              </div>
              <div>
                <label htmlFor="szuro-hova" style={{ fontSize: 12 }}>Hová (város)</label>
                <input
                  id="szuro-hova"
                  className="input"
                  type="text"
                  value={filterToCity}
                  onChange={(e) => setFilterToCity(e.target.value)}
                  placeholder="pl. Szeged"
                  style={{ width: 140 }}
                />
              </div>
              {AZONNALI_ELERHETO && (
              <div>
                <label htmlFor="szuro-tipus" style={{ fontSize: 12 }}>Típus</label>
                <select
                  id="szuro-tipus"
                  className="input"
                  value={filterType}
                  onChange={(e) => setFilterType(e.target.value as '' | 'true' | 'false')}
                  style={{ width: 150 }}
                >
                  <option value="">Mind</option>
                  <option value="false">Ajánlatkérős</option>
                  <option value="true">Azonnali</option>
                </select>
              </div>
              )}
              <div>
                <label htmlFor="szuro-min-ar" style={{ fontSize: 12 }}>Min ár (Ft)</label>
                <input
                  id="szuro-min-ar"
                  className="input"
                  type="number"
                  value={filterMinPrice}
                  onChange={(e) => setFilterMinPrice(e.target.value)}
                  placeholder="pl. 10000"
                  style={{ width: 120 }}
                />
              </div>
              <div>
                <label htmlFor="szuro-max-ar" style={{ fontSize: 12 }}>Max ár (Ft)</label>
                <input
                  id="szuro-max-ar"
                  className="input"
                  type="number"
                  value={filterMaxPrice}
                  onChange={(e) => setFilterMaxPrice(e.target.value)}
                  placeholder="pl. 100000"
                  style={{ width: 120 }}
                />
              </div>
              <div>
                <label htmlFor="szuro-max-suly" style={{ fontSize: 12 }}>Max súly (kg)</label>
                <input
                  id="szuro-max-suly"
                  className="input"
                  type="number"
                  value={filterMaxWeight}
                  onChange={(e) => setFilterMaxWeight(e.target.value)}
                  placeholder="pl. 50"
                  style={{ width: 100 }}
                />
              </div>
              <button
                className="btn"
                type="button"
                onClick={() => load(here?.lat, here?.lng)}
                style={{ fontSize: 13, padding: '8px 16px' }}
              >
                Szűrés
              </button>
              {aktivSzurokSzama(jelenlegiSzurok) > 0 && (
                <button
                  className="btn btn-secondary"
                  type="button"
                  onClick={szurokTorlese}
                  style={{ fontSize: 12, padding: '6px 12px' }}
                >
                  Szűrők törlése
                </button>
              )}
            </div>
          </div>
        )}
      </div>

      {instantError && <div className="card" role="alert">{instantError}</div>}
      {loading && <ListSkeleton rows={5} />}
      {error && (
        <div className="card" style={{ borderColor: 'var(--danger)', marginTop: 16 }}>
          <strong>Hiba:</strong> {error}
          <p className="muted">Be vagy jelentkezve? <a href="/bejelentkezes">Belépés</a>.</p>
          <button type="button" className="btn btn-secondary" onClick={() => load(here?.lat, here?.lng)}>
            Újrapróbálom
          </button>
        </div>
      )}

      {!loading && !error && jobs.length === 0 && szuroDb > 0 && (
        <EmptyState
          icon={<PackageSearch size={28} aria-hidden />}
          title="A szűrőidnek most egy fuvar sem felel meg"
          description="Próbáld tágabb feltételekkel — vagy kérj értesítést, és e-mailben szólunk, ha ilyen fuvar érkezik."
          cta={<button type="button" className="btn" onClick={szurokTorlese}>Szűrők törlése</button>}
          secondaryCta={<Link className="btn btn-ghost" href={figyeloLink(appliedSearch.current.filters)}>Értesíts, ha jön ilyen</Link>}
        />
      )}

      {!loading && !error && jobs.length === 0 && szuroDb === 0 && (
        <EmptyState
          icon={<PackageSearch size={28} aria-hidden />}
          title="Most épp nincs elérhető fuvar"
          description={JARAT_ENGEDELYEZVE
            ? 'A fuvarok folyamatosan érkeznek. Állíts be útvonal-figyelőt, és e-mailben szólunk, ha a te útvonaladra jön fuvar — vagy hirdesd meg az utad fix áron, és a feladók találnak meg téged.'
            : 'A fuvarok folyamatosan érkeznek. Állíts be útvonal-figyelőt, és e-mailben szólunk, ha a te útvonaladra jön fuvar.'}
          cta={<Link className="btn" href="/sofor/ertesitok">Útvonal-figyelő beállítása</Link>}
          secondaryCta={JARAT_ENGEDELYEZVE ? <Link className="btn btn-ghost" href="/sofor/uj-utvonal">Új útvonal meghirdetése</Link> : undefined}
        />
      )}

      {/* Térképes nézet: minden fuvar felvételi + lerakodási markerrel
          és egy halvány szaggatott vonallal. A saját posztok sárga
          markerrel jelennek meg. */}
      {!loading && !error && jobs.length > 0 && view === 'map' && (
        <div style={{ marginTop: 16 }}>
          <JobBrowseMap jobs={jobs} currentUserId={me?.id || null} />
          <TerkepJelmagyarazat elemek={[
            { szin: TERKEP_SZINEK.indulas, felirat: 'Felvétel' },
            { szin: TERKEP_SZINEK.cel, felirat: 'Lerakodás' },
            { szin: TERKEP_SZINEK.sajat, felirat: 'Saját poszt' },
          ]} />
        </div>
      )}

      {view === 'list' && jobs.map((j) => {
        const isMine = !!me && j.shipper_id === me.id;
        // IDEIGLENESEN KIKAPCSOLVA — 100+ szállító után visszakapcsolni:
        // const isInstant = !!j.is_instant;
        const isInstant = false;
        // Saját poszton csak szerkesztés/megtekintés. A részletek oldal
        // ilyenkor a feladói nézetre visz (dashboard/fuvar/[id]), hogy
        // a licitek listáját és a szerkesztést lássa.
        const href = isMine ? `/dashboard/fuvar/${j.id}` : `/sofor/fuvar/${j.id}`;

        // Stílus prioritás: instant felülírja az own-post sárgát, mert
        // az "azonnali" elvállalás időérzékeny — ott a figyelmet maximumra
        // pörgetjük.
        const cardStyle: React.CSSProperties = {
          display: 'block',
          textDecoration: 'none',
          color: 'inherit',
          marginTop: 16,
          ...(isMine ? { background: '#fefce8', borderColor: '#facc15' } : {}),
          ...(isInstant && !isMine
            ? {
                background: '#FFF8E1',
                borderColor: '#FB8C00',
                borderWidth: 2,
                boxShadow: '0 0 0 3px rgba(251,140,0,0.15)',
              }
            : {}),
        };

        return (
          <Link
            key={j.id}
            href={href}
            className={`card${isMine ? ' own-post-card' : ''}`}
            style={cardStyle}
          >
            <div className="row" style={{ justifyContent: 'space-between', alignItems: 'start' }}>
              <div style={{ flex: 1 }}>
                <div className="row" style={{ gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
                  <h3 style={{ marginTop: 0, marginBottom: 0 }}>{j.title}</h3>
                  {isInstant && (
                    <span
                      className="pill"
                      style={{
                        background: '#FB8C00',
                        color: '#fff',
                        fontWeight: 800,
                        fontSize: 11,
                        letterSpacing: 0.5,
                      }}
                      title="Azonnali fuvar: első elfogadó viszi, nincs ajánlattétel."
                    >
                      <Zap size={12} aria-hidden style={{ verticalAlign: -2 }} /> AZONNALI
                    </span>
                  )}
                  {isMine && (
                    <span
                      className="pill"
                      style={{
                        background: '#facc15',
                        color: '#713f12',
                        fontWeight: 800,
                        fontSize: 11,
                      }}
                      title="Ezt te adtad fel — nem tehetsz rá ajánlatot."
                    >
                      SAJÁT HIRDETÉS
                    </span>
                  )}
                  {/* Számla-igény: már a LISTÁBAN látszik, hogy erre a
                      fuvarra számlát kell adni. Magánszemély szállító így nem
                      megy bele feleslegesen az ajánlattételbe (2026-08-15). */}
                  {(j as any).invoice_requested && (
                    <span
                      className="pill"
                      style={{ background: 'rgba(217,119,6,0.16)', color: 'var(--text)', fontWeight: 800, fontSize: 11 }}
                      title="A feladó számlát kér a fuvardíjról — a számlát a szállító állítja ki, nem a GoFuvar."
                    >
                      Számla kell
                    </span>
                  )}
                  {(j as any).source_store && (
                    <span
                      className="pill"
                      style={{ background: '#e0e7ff', color: '#3730a3', fontWeight: 800, fontSize: 11 }}
                      title={`Bolti átvétel: ${(j as any).source_store} — tiszta, csomagolt áru, ismert átvételi pont.`}
                    >
                      <ShoppingBag size={12} aria-hidden style={{ verticalAlign: -2 }} /> {(j as any).source_store}
                    </span>
                  )}
                </div>
                {(j as any).source_image_url && (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={(j as any).source_image_url}
                    alt="A hozandó termék"
                    style={{
                      width: 64,
                      height: 64,
                      objectFit: 'cover',
                      borderRadius: 8,
                      border: '1px solid var(--border)',
                      margin: '6px 0',
                      background: 'var(--bg)',
                    }}
                    onError={(e) => { (e.currentTarget as HTMLImageElement).style.display = 'none'; }}
                  />
                )}
                <p className="muted" style={{ margin: '2px 0', display: 'flex', alignItems: 'center', gap: 4, flexWrap: 'wrap' }}>
                  <MapPin size={13} aria-hidden style={{ flexShrink: 0 }} /> {j.pickup_address}
                  {!isMine && <HazszamLakat />}
                </p>
                <p className="muted" style={{ margin: '2px 0', display: 'flex', alignItems: 'center', gap: 4, flexWrap: 'wrap' }}>
                  <Flag size={13} aria-hidden style={{ flexShrink: 0 }} /> {j.dropoff_address}
                  {!isMine && <HazszamLakat />}
                </p>
                <div className="row" style={{ marginTop: 6, gap: 16, fontSize: 13 }}>
                  {j.distance_km != null && <span className="muted">{mertek(j.distance_km, 'km')} össztáv</span>}
                  {j.distance_to_pickup_km != null && (
                    <span className="muted">{mertek(j.distance_to_pickup_km, 'km')} tőled</span>
                  )}
                  {j.weight_kg != null && <span className="muted">{mertek(j.weight_kg, 'kg')}</span>}
                  {j.length_cm && j.width_cm && j.height_cm && (
                    <span className="muted">
                      {j.length_cm}×{j.width_cm}×{j.height_cm} cm
                    </span>
                  )}
                </div>
                {j.distance_km != null && (
                  <div style={{ marginTop: 6 }}>
                    <GreenBadge distanceKm={j.distance_km} compact />
                  </div>
                )}
                {isInstant && !isMine && j.instant_expires_at && (
                  <p
                    style={{
                      fontSize: 12,
                      marginTop: 6,
                      color: '#E65100',
                      fontWeight: 600,
                    }}
                  >
                    Lejár: {new Date(j.instant_expires_at).toLocaleTimeString('hu-HU', {
                      hour: '2-digit',
                      minute: '2-digit',
                    })}
                  </p>
                )}
                {/* Bepakolás infó */}
                {((j as any).pickup_needs_carrying || (j as any).dropoff_needs_carrying) && (
                  <p style={{ fontSize: 12, marginTop: 6, color: 'var(--warning-text)', fontWeight: 600 }}>
                    <Package size={12} aria-hidden style={{ verticalAlign: -2 }} /> Cipelés:
                    {(j as any).pickup_needs_carrying && ` Felvétel ${(j as any).pickup_floor === 0 ? 'földszint' : `${(j as any).pickup_floor}. em.`}${(j as any).pickup_floor > 0 && !(j as any).pickup_has_elevator ? ' (nincs lift!)' : ''}`}
                    {(j as any).pickup_needs_carrying && (j as any).dropoff_needs_carrying && ' ·'}
                    {(j as any).dropoff_needs_carrying && ` Lerakás ${(j as any).dropoff_floor === 0 ? 'földszint' : `${(j as any).dropoff_floor}. em.`}${(j as any).dropoff_floor > 0 && !(j as any).dropoff_has_elevator ? ' (nincs lift!)' : ''}`}
                  </p>
                )}
              </div>
              <div style={{ textAlign: 'right' }}>
                {isInstant && !isMine && (
                  <button
                    type="button"
                    onClick={(e) => {
                      // Link beágyazás miatt meg kell akadályozni a navigációt,
                      // hogy csak az elvállalás fusson le.
                      e.preventDefault();
                      e.stopPropagation();
                      acceptInstant(j.id, Number(j.suggested_price_huf), j.terms_revision);
                    }}
                    disabled={acceptingInstantId != null}
                    style={{
                      marginTop: 8,
                      background: '#FB8C00',
                      color: '#fff',
                      border: 'none',
                      padding: '8px 14px',
                      borderRadius: 6,
                      fontWeight: 700,
                      cursor: acceptingInstantId ? 'wait' : 'pointer',
                      fontSize: 13,
                    }}
                  >
                    {acceptingInstantId === j.id ? 'Elvállalás…' : <><Zap size={14} aria-hidden style={{ verticalAlign: -2 }} /> Elvállalom!</>}
                  </button>
                )}
              </div>
            </div>
          </Link>
        );
      })}

      {!loading && !error && jobs.length > 0 && (
        <div className="card" style={{ marginTop: 24, display: 'flex', gap: 12, alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap' }}>
          <span style={{ fontSize: 14, display: 'flex', gap: 8, alignItems: 'center' }}>
            <Bell size={18} aria-hidden style={{ flexShrink: 0 }} /> Nem találod, amit keresel? Szólunk, ha a te útvonaladra jön fuvar.
          </span>
          <Link className="btn btn-secondary" href={figyeloLink(appliedSearch.current.filters)} style={{ textDecoration: 'none' }}>
            Értesíts, ha van ilyen fuvar
          </Link>
        </div>
      )}
    </div>
  );
}

/** A díj előtti cím utca-szintű: a házszám a kapcsolatfelvételi díj után jelenik meg. */
function HazszamLakat() {
  return (
    <span title="Házszám a díj után" style={{ display: 'inline-flex', alignItems: 'center' }}>
      <Lock size={12} aria-hidden />
      <span style={{
        position: 'absolute', width: 1, height: 1, overflow: 'hidden', clipPath: 'inset(50%)', whiteSpace: 'nowrap',
      }}>
        (házszám a díj után)
      </span>
    </span>
  );
}
