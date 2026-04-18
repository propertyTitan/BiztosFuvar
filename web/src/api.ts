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
  /** Sikeres feladói fizetés időbélyegzője (`accepted` után). */
  paid_at?: string | null;
  /** Barion fizetési URL — STUB módban `stub:...`. */
  barion_gateway_url?: string | null;
  /** Azonnali fuvar ("UberFuvar" mód) — fix ár, első elfogadó nyer. */
  is_instant?: boolean;
  instant_radius_km?: number | null;
  instant_expires_at?: string | null;
  instant_accepted_at?: string | null;
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
    const error = await res.json().catch(() => ({ error: res.statusText }));
    throw new Error(error.error || 'API hiba');
  }
  return res.json();
}

export const api = {
  login: (email: string, password: string) =>
    request<{ token: string; user: { id: string; role: string; email: string; full_name: string } }>(
      '/auth/login',
      { method: 'POST', body: JSON.stringify({ email, password }) },
    ),

  register: (body: { email: string; password: string; full_name: string; phone?: string }) =>
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
  placeBid: (jobId: string, body: { amount_huf: number; eta_minutes?: number; message?: string }) =>
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
  ) => {
    const form = new FormData();
    form.append('file', file);
    form.append('kind', kind);

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
  updateCarrierRoute: (id: string, body: {
    title?: string;
    description?: string;
    departure_at?: string;
    waypoints?: Waypoint[];
    vehicle_description?: string;
    prices?: RoutePrice[];
    status?: 'draft' | 'open' | 'full' | 'cancelled';
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
   * Lusta Barion reservation — akkor hívjuk, amikor a feladó a "Fizetés
   * Barionnal" gombra kattint. Ha a foglaláshoz már tartozik gateway URL,
   * azt kapjuk vissza; ha nem, a backend most hozza létre, elmenti, és
   * visszaadja. Idempotens, bármikor hívható egy megerősített foglalásra.
   */
  payRouteBooking: (id: string) =>
    request<{ payment_id: string; gateway_url: string; is_stub: boolean; reused: boolean }>(
      `/route-bookings/${id}/pay`,
      { method: 'POST' },
    ),

  /**
   * A fizetés NYUGTÁZÁSA — STUB módban a /fizetes-stub oldal "Fizetek most"
   * gombja hívja. Beállítja a `paid_at`-ot, értesítést küld a sofőrnek, és
   * realtime eventet szór, hogy mindkét fél UI-ja friss legyen.
   */
  confirmRouteBookingPayment: (id: string) =>
    request<{ ok: true; paid_at: string; already_paid?: boolean }>(
      `/route-bookings/${id}/confirm-payment`,
      { method: 'POST' },
    ),

  /** Licites fuvar lusta Barion reservation — ugyanaz a minta, mint a route bookingnál. */
  payJob: (id: string) =>
    request<{ payment_id: string; gateway_url: string; is_stub: boolean; reused: boolean }>(
      `/jobs/${id}/pay`,
      { method: 'POST' },
    ),

  /** Licites fuvar fizetés nyugtázása — paid_at + notif a sofőrnek. */
  confirmJobPayment: (id: string) =>
    request<{ ok: true; paid_at: string; already_paid?: boolean }>(
      `/jobs/${id}/confirm-payment`,
      { method: 'POST' },
    ),

  /** Licites fuvar lemondása. Ha már fizetve, automatikus refund (10% díjjal a feladónál). */
  cancelJob: (id: string, reason?: string) =>
    request<{ ok: true; status: string; cancellation_fee_huf: number; refund_huf: number }>(
      `/jobs/${id}/cancel`,
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
};
