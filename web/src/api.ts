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

  createJob: (job: Partial<Job>) =>
    request<Job>('/jobs', { method: 'POST', body: JSON.stringify(job) }),

  listJobs: (params: { status?: string } = {}) => {
    const qs = new URLSearchParams(params as Record<string, string>).toString();
    return request<Job[]>(`/jobs?${qs}`);
  },

  getJob: (id: string) => request<Job>(`/jobs/${id}`),
  myJobs: () => request<Job[]>('/jobs/mine/list'),

  listBids: (jobId: string) => request<Bid[]>(`/jobs/${jobId}/bids`),
  acceptBid: (bidId: string) =>
    request<{ ok: true }>(`/bids/${bidId}/accept`, { method: 'POST' }),
};
