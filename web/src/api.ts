// Megosztott API kliens a webfelülethez (Shipper Dashboard + Admin Panel).
// A backend Express szerverhez beszél (`/auth`, `/jobs`, `/bids`, `/photos`).

const BASE_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:4000';

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

  listJobs: (params: { status?: string } = {}) => {
    const qs = new URLSearchParams(params as Record<string, string>).toString();
    return request<Job[]>(`/jobs?${qs}`);
  },

  getJob: (id: string) => request<Job>(`/jobs/${id}`),
  myJobs: () => request<Job[]>('/jobs/mine/list'),

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
};
