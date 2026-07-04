// Megosztott API kliens a webfelülethez (Shipper Dashboard + Admin Panel).
// A backend Express szerverhez beszél (`/auth`, `/jobs`, `/bids`, `/photos`,
// `/carrier-routes`, `/route-bookings`).

import type { PackageSizeId } from '@/lib/packageSizes';

const BASE_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:4000';

/**
 * A backend relatív URL-eket ad vissza a feltöltött fájlokra (pl.
 * `/uploads/photo-xxx.jpg`). A böngésző viszont ezt a frontend saját
 * domainjén (gofuvar.hu) próbálja meg elérni → 404. Prefixáljuk a
 * backend URL-t, kivéve ha a válasz már teljes URL / data URL.
 *
 * Használd mindenhol, ahol backend-től kapott kép-URL-t jelenítesz meg.
 */
export function photoUrl(url?: string | null): string {
  if (!url) return '';
  // Defenzív tisztítás: ha az URL bárhol `<` vagy `>` karaktereket
  // tartalmaz (pl. env var paste weirdness vagy chat markdown), vágjuk ki
  // őket. Ez a már DB-ben tárolt "broken" URL-eket is kijavítja render
  // időben, nem csak az újakat.
  const cleaned = url.trim().replace(/[<>]/g, '').trim();
  if (
    cleaned.startsWith('http://') ||
    cleaned.startsWith('https://') ||
    cleaned.startsWith('data:')
  ) {
    return cleaned;
  }
  // Relatív URL (pl. /uploads/photo-xxx.jpg) → prefixáljuk a backend-et
  return `${BASE_URL}${cleaned.startsWith('/') ? '' : '/'}${cleaned}`;
}

// ---------- Carrier routes (új termék: sofőri útvonal-hirdetés) ----------

export type Waypoint = {
  name: string;
  formatted_address?: string;
  lat: number;
  lng: number;
  order: number;
};

export type RoutePrice = {
  size: PackageSizeId;
  price_huf: number;
};

export type CarrierRoute = {
  id: string;
  carrier_id: string;
  title: string;
  description: string | null;
  departure_at: string;
  waypoints: Waypoint[];
  vehicle_description: string | null;
  is_template: boolean;
  template_source_id: string | null;
  status: 'draft' | 'open' | 'full' | 'in_progress' | 'completed' | 'cancelled';
  is_ride_along?: boolean;
  created_at: string;
  updated_at: string;
  prices: RoutePrice[];
};

export type RouteBooking = {
  id: string;
  route_id: string;
  shipper_id: string;
  package_size: PackageSizeId;
  length_cm: number;
  width_cm: number;
  height_cm: number;
  weight_kg: number;
  pickup_address: string;
  pickup_lat: number;
  pickup_lng: number;
  dropoff_address: string;
  dropoff_lat: number;
  dropoff_lng: number;
  price_huf: number;
  delivery_code?: string | null;
  status: 'pending' | 'confirmed' | 'rejected' | 'in_progress' | 'delivered' | 'cancelled' | 'disputed';
  notes: string | null;
  barion_payment_id?: string | null;
  barion_gateway_url?: string | null;
  carrier_share_huf?: number | null;
  platform_share_huf?: number | null;
  /** A foglaláshoz rögzített kapcsolatfelvételi díj (bruttó Ft, bevezető ár). */
  connection_fee_huf?: number | null;
  created_at: string;
  confirmed_at: string | null;
  paid_at: string | null;
  delivered_at: string | null;
  route_title?: string;
  departure_at?: string;
  waypoints?: Waypoint[];
  carrier_id?: string;
  carrier_name?: string;
  shipper_name?: string;
};

export type Job = {
  id: string;
  shipper_id: string;
  carrier_id: string | null;
  title: string;
  description: string | null;
  pickup_address: string;
  pickup_lat: number;
  pickup_lng: number;
  dropoff_address: string;
  dropoff_lat: number;
  dropoff_lng: number;
  distance_km: number | null;
  weight_kg: number | null;
  volume_m3: number | null;
  length_cm: number | null;
  width_cm: number | null;
  height_cm: number | null;
  suggested_price_huf: number | null;
  accepted_price_huf: number | null;
  status:
    | 'pending'
    | 'bidding'
    | 'accepted'
    | 'in_progress'
    | 'delivered'
    | 'completed'
    | 'disputed'
    | 'cancelled';
  /** 6 számjegyű átvételi kód — a backend csak a feladónak adja vissza. */
  delivery_code?: string | null;
  /** A kapcsolatfelvételi díj sikeres fizetésének időbélyegzője (`accepted` után). */
  paid_at?: string | null;
  /** A fuvarhoz rögzített kapcsolatfelvételi díj (bruttó Ft, bevezető ár). */
  connection_fee_huf?: number | null;
  /** Hányszor lett a fuvar díjmentesen újranyitva (sofőr-csere). */
  reopened_count?: number;
  /** A másik fél elérhetősége — CSAK a díj megfizetése után adja a backend. */
  contact?: {
    role: 'carrier' | 'shipper';
    name: string | null;
    phone: string | null;
    email: string | null;
  };
  /** Barion fizetési URL — STUB módban `stub:...`. */
  barion_gateway_url?: string | null;
  /** Azonnali fuvar ("UberFuvar" mód) — fix ár, első elfogadó nyer. */
  is_instant?: boolean;
  instant_radius_km?: number | null;
  instant_expires_at?: string | null;
  instant_accepted_at?: string | null;
  /** Bepakolás / cipelés infó — a sofőr számára kulcsfontosságú. */
  pickup_needs_carrying?: boolean;
  pickup_floor?: number | null;
  pickup_has_elevator?: boolean;
  dropoff_needs_carrying?: boolean;
  dropoff_floor?: number | null;
  dropoff_has_elevator?: boolean;
  declared_value_huf?: number | null;
  invoice_requested?: boolean;
  shipper_account_type?: 'individual' | 'company';
  shipper_company_name?: string | null;
  shipper_company_verified?: string | null;
  /** "Hozasd el" forrás-bolt (IKEA/OBI/Praktiker/Jófogás) — bolti átvétel jelvény. */
  source_store?: string | null;
  /** "Hozasd el" termékkép URL-je (a hirdetés OG-előnézete) — a sofőr látja. */
  source_image_url?: string | null;
};

export type NewJobInput = {
  title: string;
  description?: string;
  pickup_address: string;
  pickup_lat: number;
  pickup_lng: number;
  dropoff_address: string;
  dropoff_lat: number;
  dropoff_lng: number;
  weight_kg: number;
  length_cm: number;
  width_cm: number;
  height_cm: number;
  suggested_price_huf: number;
  /** Ha true: azonnali fuvar, a suggested_price_huf a fix (végleges) ár. */
  is_instant?: boolean;
  /** Push értesítés sugara km-ben (alap 20). Csak ha is_instant. */
  instant_radius_km?: number;
  /** Meddig fogadható el (percben, max 240). Alap: 30 perc. */
  instant_duration_minutes?: number;
  /** A sofőrnek kell-e bepakolnia a felvételi helyen? */
  pickup_needs_carrying?: boolean;
  pickup_floor?: number;
  pickup_has_elevator?: boolean;
  /** A sofőrnek kell-e felvinnie a lerakodási helyen? */
  dropoff_needs_carrying?: boolean;
  dropoff_floor?: number;
  dropoff_has_elevator?: boolean;
  declared_value_huf?: number;
  invoice_requested?: boolean;
  recipient_name?: string;
  recipient_phone?: string;
  recipient_email?: string;
  /** "Hozasd el" forrás-bolt (IKEA/OBI/Praktiker/Jófogás) */
  source_store?: string;
  /** "Hozasd el" termékkép URL-je (a hirdetés OG-előnézete) */
  source_image_url?: string;
};

export type BackhaulCandidate = Job & {
  backhaul_pickup_from_dest_km: number;
  backhaul_drop_from_origin_km: number;
  backhaul_score: number;
  shipper_name?: string;
  shipper_rating_avg?: number;
  shipper_rating_count?: number;
};

export type BackhaulGroup = {
  trip_id: string;
  trip_title: string;
  trip_pickup_address: string;
  trip_dropoff_address: string;
  candidates: BackhaulCandidate[];
};

export type Bid = {
  id: string;
  job_id: string;
  carrier_id: string;
  amount_huf: number;
  message: string | null;
  eta_minutes: number | null;
  status: 'pending' | 'accepted' | 'rejected' | 'withdrawn';
  // Sikertelen kézbesítés esetén történő visszaszállítás nyilatkozata
  return_policy?: 'included' | 'extra_fee' | 'no' | null;
  return_fee_huf?: number | null;
  // A backend a licit mellé adja a sofőr adatait is (bids.js JOIN)
  carrier_name?: string | null;
  rating_avg?: number | null;
  rating_count?: number | null;
  // Ellenajánlat (Vinted-stílusú alku)
  counter_amount_huf?: number | null;
  counter_by?: 'shipper' | 'carrier' | null;
  counter_at?: string | null;
};

function getToken(): string | null {
  if (typeof window === 'undefined') return null;
  return window.localStorage.getItem('gofuvar_token');
}

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...(init.headers as Record<string, string> | undefined),
  };
  const token = getToken();
  if (token) headers['Authorization'] = `Bearer ${token}`;
  const res = await fetch(`${BASE_URL}${path}`, { ...init, headers });
  if (!res.ok) {
    // Token lejárt / érvénytelen → automatikus kijelentkezés + átirányítás.
    // KIVÉTEL az anonim auth-végpontok (login, regisztráció, jelszó-reset):
    // ott a 401 azt jelenti, "rossz email/jelszó" — ha ide is átirányítanánk,
    // az oldal újratöltődne és a felhasználó SOSEM látná a hibaüzenetet.
    const anonAuthPaths = ['/auth/login', '/auth/register', '/auth/forgot-password', '/auth/reset-password'];
    const isAnonAuth = anonAuthPaths.some((p) => path.startsWith(p));
    if (res.status === 401 && !isAnonAuth && typeof window !== 'undefined') {
      window.localStorage.removeItem('gofuvar_token');
      window.localStorage.removeItem('gofuvar_user');
      window.dispatchEvent(new CustomEvent('gofuvar:session-expired'));
      window.location.href = '/bejelentkezes';
      throw new Error('A munkameneted lejárt. Kérlek, jelentkezz be újra.');
    }
    const errorData = await res.json().catch(() => ({ error: res.statusText }));
    if (res.status === 403 && typeof window !== 'undefined') {
      const kycCodes = ['IDENTITY_KYC_REQUIRED', 'DRIVER_KYC_REQUIRED', 'COMPANY_KYC_REQUIRED'];
      if (errorData.code === 'OUTSIDE_COVERAGE') {
        window.dispatchEvent(new CustomEvent('gofuvar:outside-coverage', { detail: { error: errorData.error } }));
      } else if (errorData.code && kycCodes.includes(errorData.code)) {
        window.dispatchEvent(new CustomEvent('gofuvar:kyc-required', { detail: { code: errorData.code } }));
      }
    }
    throw new Error(errorData.error || 'API hiba');
  }
  return res.json();
}

export const api = {
  login: (email: string, password: string) =>
    request<{ token: string; user: { id: string; role: string; email: string; full_name: string } }>(
      '/auth/login',
      { method: 'POST', body: JSON.stringify({ email, password }) },
    ),

  register: (body: {
    email: string; password: string; full_name: string; phone?: string;
    account_type?: 'individual' | 'company';
    company_name?: string; tax_id?: string; company_reg_number?: string;
    eu_vat_number?: string; billing_address?: string;
  }) =>
    request<{ token: string; user: { id: string; role: string; email: string; full_name: string } }>(
      '/auth/register',
      { method: 'POST', body: JSON.stringify(body) },
    ),

  createJob: (job: NewJobInput) =>
    request<Job>('/jobs', { method: 'POST', body: JSON.stringify(job) }),

  listJobs: (params: {
    status?: string; lat?: number; lng?: number; radius_km?: number;
    min_price?: number; max_price?: number; max_weight_kg?: number;
    /** 'true' = csak azonnali fuvarok, 'false' = csak licites, undefined = mind. */
    instant?: 'true' | 'false';
  } = {}) => {
    const qs = new URLSearchParams();
    if (params.status) qs.set('status', params.status);
    if (params.lat != null) qs.set('lat', String(params.lat));
    if (params.lng != null) qs.set('lng', String(params.lng));
    if (params.radius_km != null) qs.set('radius_km', String(params.radius_km));
    if (params.min_price != null) qs.set('min_price', String(params.min_price));
    if (params.max_price != null) qs.set('max_price', String(params.max_price));
    if (params.max_weight_kg != null) qs.set('max_weight_kg', String(params.max_weight_kg));
    if (params.instant) qs.set('instant', params.instant);
    return request<(Job & { distance_to_pickup_km?: number })[]>(`/jobs?${qs.toString()}`);
  },

  /** Azonnali fuvar elfogadása (első sofőr nyer, 409-et kap a többi). */
  acceptInstantJob: (jobId: string) =>
    request<{
      ok: true;
      job_id: string;
      carrier_id: string;
      amount_huf: number;
      barion: { gateway_url: string | null; payment_id: string | null };
    }>(`/jobs/${jobId}/instant-accept`, { method: 'POST' }),

  /** Visszafuvar-ajánlások a hívó sofőr összes aktív fuvarához. */
  backhaulSuggestions: () =>
    request<{ groups: BackhaulGroup[] }>('/backhaul/suggestions'),

  /** Egy konkrét aktív fuvarhoz tartozó visszafuvar-jelöltek. */
  backhaulForTrip: (jobId: string) =>
    request<{ trip_id: string; candidates: BackhaulCandidate[] }>(
      `/backhaul/for-trip/${jobId}`,
    ),

  getJob: (id: string) => request<Job>(`/jobs/${id}`),

  /**
   * Saját fuvarok — két külön lista szemszögtől függően:
   * - as=posted   → amiket én adtam fel
   * - as=assigned → amiket én teljesítek sofőrként
   */
  myJobs: (as: 'posted' | 'assigned' = 'posted') =>
    request<Job[]>(`/jobs/mine/list?as=${as}`),

  /** Sofőr licitet ad egy fuvarra. */
  placeBid: (
    jobId: string,
    body: {
      amount_huf: number;
      eta_minutes?: number;
      message?: string;
      return_policy: 'included' | 'extra_fee' | 'no';
      return_fee_huf?: number;
    },
  ) =>
    request<Bid>(`/jobs/${jobId}/bids`, { method: 'POST', body: JSON.stringify(body) }),

  /**
   * A bejelentkezett sofőr összes licitje a kapcsolódó fuvar alap mezőivel.
   * A sofőr ebből látja: mire licitált, mi a licit + fuvar állapota,
   * és hogy az adott fuvart neki ítélték-e oda.
   */
  myBids: () =>
    request<Array<{
      bid_id: string;
      amount_huf: number;
      eta_minutes: number | null;
      message: string | null;
      bid_status: 'pending' | 'accepted' | 'rejected' | 'withdrawn';
      bid_created_at: string;
      job_id: string;
      job_title: string;
      job_status: Job['status'];
      pickup_address: string;
      dropoff_address: string;
      distance_km: number | null;
      suggested_price_huf: number | null;
      accepted_price_huf: number | null;
      job_carrier_id: string | null;
    }>>('/bids/mine'),

  listBids: (jobId: string) => request<Bid[]>(`/jobs/${jobId}/bids`),
  acceptBid: (bidId: string) =>
    request<{ ok: true; barion?: { gateway_url: string | null } }>(
      `/bids/${bidId}/accept`,
      { method: 'POST' },
    ),

  /** Ellenajánlat a licit összegére (feladó vagy sofőr is teheti). */
  counterBid: (bidId: string, amount: number) =>
    request<{ ok: true; counter_amount_huf: number; counter_by: string }>(
      `/bids/${bidId}/counter`,
      { method: 'POST', body: JSON.stringify({ amount }) },
    ),

  /** A sofőr elfogadja a feladó ellenajánlatát → megállapodás. */
  acceptCounter: (bidId: string) =>
    request<{ ok: true; job_id: string; amount_huf: number }>(
      `/bids/${bidId}/accept-counter`,
      { method: 'POST' },
    ),

  /** Egy fuvar utolsó GPS pozíciója (élő követés első snapshot-ja). */
  lastLocation: (jobId: string) =>
    request<{ lat: number; lng: number; speed_kmh: number | null; recorded_at: string } | null>(
      `/jobs/${jobId}/location/last`,
    ),

  /** Egy fuvar összes fotója (listing + pickup + dropoff + damage + document). */
  listPhotos: (jobId: string) =>
    request<Array<{
      id: string;
      kind: 'listing' | 'pickup' | 'dropoff' | 'damage' | 'document';
      url: string;
      gps_lat: number | null;
      gps_lng: number | null;
      taken_at: string;
      ai_has_cargo: boolean | null;
    }>>(`/jobs/${jobId}/photos`),

  /**
   * Fotó feltöltés multipart/form-data-val.
   * - 'listing' típusnál a feladó tölt fel (nem kell GPS).
   * - 'pickup' / 'dropoff' típusnál a sofőr tölt fel GPS-sel.
   */
  uploadJobPhoto: async (
    jobId: string,
    file: File,
    kind: 'listing' | 'pickup' | 'dropoff' | 'damage' | 'document',
    opts?: { deliveryCode?: string },
  ) => {
    const form = new FormData();
    form.append('file', file);
    form.append('kind', kind);
    if (opts?.deliveryCode) form.append('delivery_code', opts.deliveryCode);

    const token = getToken();
    const res = await fetch(`${BASE_URL}/jobs/${jobId}/photos`, {
      method: 'POST',
      headers: token ? { Authorization: `Bearer ${token}` } : undefined,
      body: form,
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({ error: res.statusText }));
      throw new Error(err.error || 'Fotó feltöltés sikertelen');
    }
    return res.json();
  },

  /** Foglalás pickup/dropoff fotó — a fuvar-fotó tükre (BUG-041 fix). */
  uploadBookingPhoto: async (
    bookingId: string,
    file: File,
    kind: 'pickup' | 'dropoff' | 'damage' | 'document',
    opts?: { deliveryCode?: string },
  ) => {
    const form = new FormData();
    form.append('file', file);
    form.append('kind', kind);
    if (opts?.deliveryCode) form.append('delivery_code', opts.deliveryCode);

    const token = getToken();
    const res = await fetch(`${BASE_URL}/route-bookings/${bookingId}/photos`, {
      method: 'POST',
      headers: token ? { Authorization: `Bearer ${token}` } : undefined,
      body: form,
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({ error: res.statusText }));
      throw new Error(err.error || 'Fotó feltöltés sikertelen');
    }
    return res.json();
  },

  /** Egy foglalás fotói (csak a felek láthatják). */
  listBookingPhotos: (bookingId: string) =>
    request<any[]>(`/route-bookings/${bookingId}/photos`),

  /** Escrow / Barion állapot egy fuvarhoz. */
  jobEscrow: (jobId: string) =>
    request<{
      amount_huf: number;
      status: 'held' | 'released' | 'refunded';
      barion_payment_id: string | null;
      barion_gateway_url: string | null;
      carrier_share_huf: number | null;
      platform_share_huf: number | null;
    } | null>(`/jobs/${jobId}/escrow`),

  // ---------- Sofőri útvonal-hirdetés ----------

  /** Új útvonal létrehozása (sofőr). */
  createCarrierRoute: (body: {
    title: string;
    description?: string;
    departure_at: string; // ISO
    waypoints: Waypoint[];
    vehicle_description?: string;
    is_template?: boolean;
    template_source_id?: string;
    prices: RoutePrice[];
    status?: 'draft' | 'open';
    is_ride_along?: boolean;
  }) =>
    request<CarrierRoute>('/carrier-routes', {
      method: 'POST',
      body: JSON.stringify(body),
    }),

  /** A sofőr saját útvonalai (sablonok + publikáltak + régiek). */
  myCarrierRoutes: () => request<CarrierRoute[]>('/carrier-routes/mine'),

  /**
   * Nyitott útvonalak böngészése (feladónak).
   * Opcionális város-szűrés (a waypoints JSONB-ben keres).
   */
  listCarrierRoutes: (params: { city?: string; from_date?: string; to_date?: string } = {}) => {
    const qs = new URLSearchParams();
    if (params.city) qs.set('city', params.city);
    if (params.from_date) qs.set('from_date', params.from_date);
    if (params.to_date) qs.set('to_date', params.to_date);
    return request<CarrierRoute[]>(
      `/carrier-routes${qs.toString() ? `?${qs}` : ''}`,
    );
  },

  getCarrierRoute: (id: string) => request<CarrierRoute>(`/carrier-routes/${id}`),

  setCarrierRouteStatus: (id: string, status: 'draft' | 'open' | 'full' | 'cancelled') =>
    request<CarrierRoute>(`/carrier-routes/${id}/status`, {
      method: 'PATCH',
      body: JSON.stringify({ status }),
    }),

  /** Teljes útvonal szerkesztés (a tulajdonos bármikor módosíthatja). */
  /** Útba eső fuvarok egy adott útvonalhoz. */
  alongJobs: (routeId: string) =>
    request<{ route_id: string; jobs: (Job & {
      along_pickup_wp_name: string;
      along_dropoff_wp_name: string;
      along_pickup_detour_km: number;
      along_dropoff_detour_km: number;
      along_detour_km: number;
      shipper_name?: string;
    })[] }>(`/carrier-routes/${routeId}/along-jobs`),

  updateCarrierRoute: (id: string, body: {
    title?: string;
    description?: string;
    departure_at?: string;
    waypoints?: Waypoint[];
    vehicle_description?: string;
    prices?: RoutePrice[];
    status?: 'draft' | 'open' | 'full' | 'cancelled';
    is_ride_along?: boolean;
  }) =>
    request<CarrierRoute>(`/carrier-routes/${id}`, {
      method: 'PATCH',
      body: JSON.stringify(body),
    }),

  /** Feladói foglalás egy útvonalra. */
  createRouteBooking: (
    routeId: string,
    body: {
      length_cm: number;
      width_cm: number;
      height_cm: number;
      weight_kg: number;
      pickup_address: string;
      pickup_lat: number;
      pickup_lng: number;
      dropoff_address: string;
      dropoff_lat: number;
      dropoff_lng: number;
      notes?: string;
    },
  ) =>
    request<RouteBooking>(`/carrier-routes/${routeId}/bookings`, {
      method: 'POST',
      body: JSON.stringify(body),
    }),

  /** Egy adott útvonal beérkezett foglalásai (sofőr oldalon). */
  listRouteBookings: (routeId: string) =>
    request<RouteBooking[]>(`/carrier-routes/${routeId}/bookings`),

  /** A feladó saját foglalásai. */
  myRouteBookings: () => request<RouteBooking[]>('/route-bookings/mine'),

  getRouteBooking: (id: string) => request<RouteBooking>(`/route-bookings/${id}`),

  /** Sofőr elfogadja a foglalást → Barion escrow lefoglalás. */
  confirmRouteBooking: (id: string) =>
    request<{ ok: true; booking_id: string; barion?: { gateway_url: string | null } }>(
      `/route-bookings/${id}/confirm`,
      { method: 'POST' },
    ),

  rejectRouteBooking: (id: string) =>
    request<{ ok: true }>(`/route-bookings/${id}/reject`, { method: 'POST' }),

  /**
   * A kapcsolatfelvételi díj fizetésének (lusta) indítása — akkor hívjuk,
   * amikor a feladó a fizetés gombra kattint. Ha a foglaláshoz már tartozik
   * gateway URL, azt kapjuk vissza; ha nem, a backend most hozza létre.
   * Idempotens, bármikor hívható egy megerősített foglalásra.
   */
  payRouteBooking: (id: string) =>
    request<{ payment_id: string; gateway_url: string; fee_huf: number; is_stub: boolean; reused: boolean }>(
      `/route-bookings/${id}/pay`,
      { method: 'POST' },
    ),

  /**
   * A díj-fizetés NYUGTÁZÁSA — STUB módban a /fizetes-stub oldal "Fizetek
   * most" gombja hívja. A `consent` KÖTELEZŐ: a feladó kéri az azonnali
   * teljesítést (kontakt-átadás) és tudomásul veszi, hogy utána elállási
   * joga elvész (45/2014. Korm. r. 29. § (1) a)).
   */
  confirmRouteBookingPayment: (id: string, consent: boolean) =>
    request<{ ok: true; paid_at: string; already_paid?: boolean }>(
      `/route-bookings/${id}/confirm-payment`,
      { method: 'POST', body: JSON.stringify({ consent }) },
    ),

  /** Licites fuvar kapcsolatfelvételi díj fizetés-indítása — ugyanaz a minta, mint a route bookingnál. */
  payJob: (id: string) =>
    request<{ payment_id: string; gateway_url: string; fee_huf: number; is_stub: boolean; reused: boolean }>(
      `/jobs/${id}/pay`,
      { method: 'POST' },
    ),

  /** Licites fuvar díj-fizetés nyugtázása — consent kötelező (elállási jog tudomásulvétele). */
  confirmJobPayment: (id: string, consent: boolean) =>
    request<{ ok: true; paid_at: string; already_paid?: boolean }>(
      `/jobs/${id}/confirm-payment`,
      { method: 'POST', body: JSON.stringify({ consent }) },
    ),

  /**
   * Licites fuvar lemondása. Pénzmozgás nincs (a fuvardíj készpénzes, a
   * kapcsolatfelvételi díj nem visszatérítendő). Ha a SOFŐR mondja le,
   * a fuvar díjmentesen újranyílik (reopened: true).
   */
  cancelJob: (id: string, reason?: string) =>
    request<{ ok: true; status: string; cancellation_fee_huf: number; refund_huf: number; reopened?: boolean; fee_kept?: boolean }>(
      `/jobs/${id}/cancel`,
      { method: 'POST', body: JSON.stringify({ reason }) },
    ),

  /**
   * Sofőr-csere: a feladó újranyitja az elfogadott fuvart (a sofőr nem
   * elérhető / visszalépett). A korábbi licitek újra választhatók, a
   * befizetett kapcsolatfelvételi díj erre a fuvarra érvényes marad.
   */
  reopenJob: (id: string, reason?: string) =>
    request<{ ok: true; status: string; reopened: boolean }>(
      `/jobs/${id}/reopen`,
      { method: 'POST', body: JSON.stringify({ reason }) },
    ),

  /** Fix áras foglalás lemondása. */
  cancelRouteBooking: (id: string, reason?: string) =>
    request<{ ok: true; status: string; cancellation_fee_huf: number; refund_huf: number }>(
      `/route-bookings/${id}/cancel`,
      { method: 'POST', body: JSON.stringify({ reason }) },
    ),

  // ---------- Notifications ----------

  listNotifications: () =>
    request<Array<{
      id: string;
      type: string;
      title: string;
      body: string | null;
      link: string | null;
      read_at: string | null;
      created_at: string;
    }>>('/notifications'),

  unreadNotificationCount: () =>
    request<{ count: number }>('/notifications/unread-count'),

  markNotificationRead: (id: string) =>
    request<{ id: string; read_at: string }>(`/notifications/${id}/read`, {
      method: 'POST',
    }),

  markAllNotificationsRead: () =>
    request<{ ok: true }>('/notifications/read-all', { method: 'POST' }),

  // ---------- AI chat ----------

  // ---------- Gamification ----------

  getGameStats: () => request<any>('/auth/me/game-stats'),
  getDriverDashboard: () => request<any>('/auth/me/driver-dashboard'),

  // ---------- Admin ----------

  adminStats: () => request<any>('/auth/admin/stats'),

  /** Felhasználók listája aktivitás-adatokkal (utolsó belépés, aktív idő). */
  adminUsers: (search?: string, limit = 200) =>
    request<Array<{
      id: string;
      email: string;
      full_name: string | null;
      role: string;
      created_at: string;
      last_login_at: string | null;
      login_count: number;
      last_seen_at: string | null;
      total_active_seconds: number;
    }>>(`/admin/users?limit=${limit}${search ? `&search=${encodeURIComponent(search)}` : ''}`),

  /** KYC dokumentumok listája státusz szerint (alapból a függőben lévők). */
  adminKycDocuments: (status: 'pending' | 'approved' | 'rejected' = 'pending') =>
    request<Array<{
      id: string;
      user_id: string;
      doc_type: string;
      file_url: string;
      doc_number: string | null;
      full_name_on_doc: string | null;
      expiry_date: string | null;
      status: string;
      rejection_reason: string | null;
      created_at: string;
      full_name: string | null;
      email: string;
    }>>(`/admin/kyc-documents?status=${status}`),

  /** KYC dokumentum jóváhagyása / elutasítása (elutasításhoz indok kell). */
  reviewKyc: (id: string, action: 'approve' | 'reject', reason?: string) =>
    request<{ ok: boolean; status: string }>(`/admin/kyc-documents/${id}`, {
      method: 'PATCH',
      body: JSON.stringify({ action, reason }),
    }),

  /** Élő jelenlét — kik vannak éppen az oldalon (aktív socket-kapcsolatok). */
  adminLive: () =>
    request<{
      online_users: number;
      total_connections: number;
      anonymous: number;
      by_role: Record<string, number>;
      users: Array<{ id: string; role: string; email: string | null; connections: number }>;
    }>('/admin/live'),

  adminPaymentLog: (limit = 50) =>
    request<any[]>(`/payments/admin/log?limit=${limit}`),

  // ---------- Profile ----------

  getMyProfile: () =>
    request<any>('/auth/me'),

  updateMyProfile: (data: {
    full_name?: string; phone?: string; vehicle_type?: string;
    vehicle_plate?: string; bio?: string; avatar_url?: string;
  }) =>
    request<any>('/auth/me', { method: 'PATCH', body: JSON.stringify(data) }),

  getUserProfile: (id: string) =>
    request<any>(`/auth/users/${id}/profile`),

  // ---------- Chat / Messages ----------

  sendMessage: (body: { job_id?: string; booking_id?: string; body: string }) =>
    request<any>('/messages', { method: 'POST', body: JSON.stringify(body) }),

  getMessages: (params: { job_id?: string; booking_id?: string }) => {
    const qs = new URLSearchParams(
      Object.fromEntries(Object.entries(params).filter(([, v]) => !!v)),
    ).toString();
    return request<any[]>(`/messages?${qs}`);
  },

  // ---------- Reviews ----------

  submitReview: (body: { job_id?: string; booking_id?: string; stars: number; comment?: string }) =>
    request<any>('/reviews', { method: 'POST', body: JSON.stringify(body) }),

  getReviews: (params: { job_id?: string; booking_id?: string; user_id?: string }) => {
    const qs = new URLSearchParams(
      Object.fromEntries(Object.entries(params).filter(([, v]) => !!v)),
    ).toString();
    return request<any[]>(`/reviews?${qs}`);
  },

  // ---------- Disputes ----------

  openDispute: (body: { job_id?: string; booking_id?: string; description: string; evidence_url?: string }) =>
    request<any>('/disputes', { method: 'POST', body: JSON.stringify(body) }),

  myDisputes: () => request<any[]>('/disputes/mine'),

  /** Admin: ÖSSZES vita (a /mine adminnak jellemzően üres volt) */
  allDisputes: () => request<any[]>('/disputes'),

  getDispute: (id: string) => request<any>(`/disputes/${id}`),

  resolveDispute: (id: string, body: { status: string; resolution_note?: string; refund_huf?: number }) =>
    request<any>(`/disputes/${id}`, { method: 'PATCH', body: JSON.stringify(body) }),

  // ---------- AI ----------

  aiChat: (
    message: string,
    history: Array<{ role: 'user' | 'assistant'; content: string }>,
  ) =>
    request<{ reply: string }>('/ai/chat', {
      method: 'POST',
      body: JSON.stringify({ message, history }),
    }),

  // ==================== AUTÓMENTÉS ====================

  requestTowing: (body: {
    lat: number; lng: number; address?: string;
    issue_type: string; issue_description?: string;
    vehicle_type?: string; vehicle_plate?: string;
    search_radius_km?: number;
  }) =>
    request<{ id: string; status: string }>('/towing/request', {
      method: 'POST', body: JSON.stringify(body),
    }),

  cancelTowing: (towId: string) =>
    request<{ ok: true }>(`/towing/${towId}/cancel`, { method: 'POST' }),

  towingIncoming: (lat?: number, lng?: number) => {
    const qs = new URLSearchParams();
    if (lat != null) qs.set('lat', String(lat));
    if (lng != null) qs.set('lng', String(lng));
    return request<Array<any>>(`/towing/incoming${qs.toString() ? `?${qs}` : ''}`);
  },

  acceptTowing: (towId: string, estimatedPriceHuf?: number) =>
    request<{ ok: true }>(`/towing/${towId}/accept`, {
      method: 'POST',
      body: JSON.stringify({ estimated_price_huf: estimatedPriceHuf }),
    }),

  arriveTowing: (towId: string) =>
    request<{ ok: true }>(`/towing/${towId}/arrive`, { method: 'POST' }),

  completeTowing: (towId: string, finalPriceHuf?: number) =>
    request<{ ok: true }>(`/towing/${towId}/complete`, {
      method: 'POST',
      body: JSON.stringify({ final_price_huf: finalPriceHuf }),
    }),

  registerTowDriver: (body: { tow_services: string[]; tow_vehicle_description?: string }) =>
    request<any>('/towing/register', {
      method: 'POST', body: JSON.stringify(body),
    }),

  toggleTowAvailable: (available: boolean) =>
    request<{ tow_available: boolean }>('/towing/toggle-available', {
      method: 'POST', body: JSON.stringify({ available }),
    }),

  myTowRequests: () => request<any[]>('/towing/my-requests'),

  /** Sofőr bevétel és teljesítmény statisztikák. */
  driverStats: () => request<any>('/driver-stats'),

  /** SOS vészjelzés küldése. */
  sendSOS: (body: { job_id?: string; booking_id?: string; lat?: number; lng?: number; message?: string }) =>
    request<{ ok: true; sos_id: string }>('/sos', {
      method: 'POST',
      body: JSON.stringify(body),
    }),

  // ---------- KYC ----------

  uploadKycDocument: async (file: File, docType: string) => {
    const form = new FormData();
    form.append('file', file);
    form.append('doc_type', docType);
    const token = getToken();
    const res = await fetch(`${BASE_URL}/auth/kyc-document`, {
      method: 'POST',
      headers: token ? { Authorization: `Bearer ${token}` } : undefined,
      body: form,
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({ error: res.statusText }));
      throw new Error(err.error || 'KYC dokumentum feltöltés sikertelen');
    }
    return res.json() as Promise<{
      ok: boolean;
      doc_type: string;
      status: string;
      file_url: string;
      underage?: boolean;
      ai_reason?: string | null;
    }>;
  },

  getKycStatus: () =>
    request<{
      identity_kyc_status: string;
      driver_kyc_status: string;
      company_verification_status: string;
      account_type: string;
      documents: Array<{ doc_type: string; status: string; rejection_reason?: string; created_at: string }>;
    }>('/auth/kyc-status'),

  /** Ár-kalkulátor (publikus, nem kell auth). */
  priceEstimate: async (params: {
    pickup_lat: number; pickup_lng: number;
    dropoff_lat: number; dropoff_lng: number;
    weight_kg?: number;
    volume_m3?: number;
    pickup_floor?: number; pickup_has_elevator?: boolean;
    dropoff_floor?: number; dropoff_has_elevator?: boolean;
  }) => {
    const qs = new URLSearchParams();
    qs.set('pickup_lat', String(params.pickup_lat));
    qs.set('pickup_lng', String(params.pickup_lng));
    qs.set('dropoff_lat', String(params.dropoff_lat));
    qs.set('dropoff_lng', String(params.dropoff_lng));
    if (params.weight_kg != null) qs.set('weight_kg', String(params.weight_kg));
    if (params.volume_m3 != null) qs.set('volume_m3', String(params.volume_m3));
    if (params.pickup_floor != null) qs.set('pickup_floor', String(params.pickup_floor));
    if (params.pickup_has_elevator != null) qs.set('pickup_has_elevator', String(params.pickup_has_elevator));
    if (params.dropoff_floor != null) qs.set('dropoff_floor', String(params.dropoff_floor));
    if (params.dropoff_has_elevator != null) qs.set('dropoff_has_elevator', String(params.dropoff_has_elevator));
    const res = await fetch(`${BASE_URL}/calculator/estimate?${qs.toString()}`);
    if (!res.ok) throw new Error('Kalkulátor hiba');
    return res.json() as Promise<{
      distance_km: number;
      weight_kg: number;
      estimate_huf: number;
      range_low_huf: number;
      range_high_huf: number;
      note: string;
    }>;
  },

  // ---------- Jelszó & email-megerősítés ----------
  forgotPassword: (email: string) =>
    request<{ ok: true; message: string }>('/auth/forgot-password', {
      method: 'POST',
      body: JSON.stringify({ email }),
    }),
  resetPassword: (token: string, password: string) =>
    request<{ ok: true }>('/auth/reset-password', {
      method: 'POST',
      body: JSON.stringify({ token, password }),
    }),
  verifyEmail: (token: string) =>
    request<{ ok: true }>(`/auth/verify-email?token=${encodeURIComponent(token)}`),
  resendVerification: () =>
    request<{ ok: true; already_verified?: boolean }>('/auth/resend-verification', { method: 'POST' }),

  // ---------- Publikus Q&A a fuvarokhoz ----------
  listJobQuestions: (jobId: string) =>
    request<Array<{
      id: string;
      question: string;
      answer: string | null;
      created_at: string;
      answered_at: string | null;
      asker_name: string;
      asker_id: string;
      answerer_name: string | null;
    }>>(`/jobs/${jobId}/questions`),

  askJobQuestion: (jobId: string, question: string) =>
    request<any>(`/jobs/${jobId}/questions`, {
      method: 'POST',
      body: JSON.stringify({ question }),
    }),

  answerJobQuestion: (questionId: string, answer: string) =>
    request<any>(`/questions/${questionId}/answer`, {
      method: 'POST',
      body: JSON.stringify({ answer }),
    }),

  // ---------- Sofőr útvonal-figyelők (lane alerts) ----------

  listCarrierAlerts: () => request<CarrierAlert[]>('/carrier-alerts'),

  createCarrierAlert: (data: Partial<CarrierAlert>) =>
    request<CarrierAlert>('/carrier-alerts', {
      method: 'POST',
      body: JSON.stringify(data),
    }),

  setCarrierAlertActive: (id: string, active: boolean) =>
    request<CarrierAlert>(`/carrier-alerts/${id}`, {
      method: 'PATCH',
      body: JSON.stringify({ active }),
    }),

  deleteCarrierAlert: (id: string) =>
    request<{ ok: true }>(`/carrier-alerts/${id}`, { method: 'DELETE' }),

  // ---------- "Hozasd el" — hirdetés-link előnézet ----------
  linkPreview: async (url: string) => {
    const res = await fetch(`${BASE_URL}/link-preview?url=${encodeURIComponent(url)}`);
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || 'Nem támogatott link');
    return data as {
      ok: boolean;
      source: string;
      url: string;
      title?: string | null;
      image?: string | null;
      description?: string | null;
    };
  },
};

export type CarrierAlert = {
  id: string;
  label: string | null;
  from_lat: number;
  from_lng: number;
  from_label: string | null;
  to_lat: number | null;
  to_lng: number | null;
  to_label: string | null;
  radius_km: number;
  min_price_huf: number | null;
  max_weight_kg: number | null;
  active: boolean;
  created_at: string;
};
