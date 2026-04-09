// Megosztott API kliens a webfelülethez (Shipper Dashboard + Admin Panel).
// A backend Express szerverhez beszél (`/auth`, `/jobs`, `/bids`, `/photos`,
// `/carrier-routes`, `/route-bookings`).

import type { PackageSizeId } from '@/lib/packageSizes';

const BASE_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:4000';

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
  created_at: string;
  confirmed_at: string | null;
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
  return window.localStorage.getItem('biztosfuvar_token');
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
    request<{ token: string; user: { id: string; role: string } }>(
      '/auth/login',
      { method: 'POST', body: JSON.stringify({ email, password }) },
    ),

  createJob: (job: NewJobInput) =>
    request<Job>('/jobs', { method: 'POST', body: JSON.stringify(job) }),

  listJobs: (params: { status?: string; lat?: number; lng?: number; radius_km?: number } = {}) => {
    const qs = new URLSearchParams();
    if (params.status) qs.set('status', params.status);
    if (params.lat != null) qs.set('lat', String(params.lat));
    if (params.lng != null) qs.set('lng', String(params.lng));
    if (params.radius_km != null) qs.set('radius_km', String(params.radius_km));
    return request<(Job & { distance_to_pickup_km?: number })[]>(`/jobs?${qs.toString()}`);
  },

  getJob: (id: string) => request<Job>(`/jobs/${id}`),
  myJobs: () => request<Job[]>('/jobs/mine/list'),

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
  listCarrierRoutes: (params: { city?: string } = {}) => {
    const qs = new URLSearchParams();
    if (params.city) qs.set('city', params.city);
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
};
