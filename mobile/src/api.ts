// Megosztott API kliens a mobil (Expo / React Native) alkalmazáshoz.
// Ugyanazokat a backend végpontokat hívja, mint a web kliens.
// A FormData a fotó-feltöltéshez React Native-ben natívan támogatott.

import AsyncStorage from '@react-native-async-storage/async-storage';

const BASE_URL =
  process.env.EXPO_PUBLIC_API_URL ?? 'http://localhost:4000';

// 15 másodperc után lemondunk a hívásról. Ennek köszönhetően ha a
// telefon nem látja a backend-et (pl. a `.env`-ben `localhost` maradt,
// miközben a mobil fizikai eszköz és a `localhost` a telefonra mutat),
// akkor **értelmes** hibaüzenetet kap a felhasználó ahelyett, hogy
// a login gomb örökké "Belépés…"-t mutatna.
const REQUEST_TIMEOUT_MS = 15_000;

async function getToken(): Promise<string | null> {
  return AsyncStorage.getItem('gofuvar_token');
}

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...((init.headers as Record<string, string>) || {}),
  };
  const token = await getToken();
  if (token) headers['Authorization'] = `Bearer ${token}`;

  // AbortController-rel tudjuk 15 mp után megszakítani a fetch-et.
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  let res: Response;
  try {
    res = await fetch(`${BASE_URL}${path}`, {
      ...init,
      headers,
      signal: controller.signal,
    });
  } catch (err: any) {
    if (err?.name === 'AbortError') {
      throw new Error(
        `Időtúllépés – nem érem el a backendet (${BASE_URL}). ` +
        `Ha fizikai telefonról tesztelsz, a mobile/.env-ben írd át az ` +
        `EXPO_PUBLIC_API_URL-t a géped LAN IP-jére, pl. http://192.168.1.42:4000`,
      );
    }
    throw new Error(
      `Hálózati hiba – ${BASE_URL} nem elérhető. Ellenőrizd, hogy fut-e ` +
      `a backend, és hogy a telefon ugyanazon a WiFi-n van-e, mint a gép.`,
    );
  } finally {
    clearTimeout(timer);
  }

  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: res.statusText }));
    throw new Error(err.error || 'API hiba');
  }
  return res.json() as Promise<T>;
}

export const api = {
  login: (email: string, password: string) =>
    request<{ token: string; user: any }>('/auth/login', {
      method: 'POST',
      body: JSON.stringify({ email, password }),
    }),

  /** Licitálható fuvarok közelség + szűrők szerint. */
  nearbyJobs: (lat: number, lng: number, radiusKm = 50, filters?: {
    min_price?: number; max_price?: number; max_weight_kg?: number;
  }) => {
    const qs = new URLSearchParams({
      status: 'bidding',
      lat: String(lat),
      lng: String(lng),
      radius_km: String(radiusKm),
    });
    if (filters?.min_price) qs.set('min_price', String(filters.min_price));
    if (filters?.max_price) qs.set('max_price', String(filters.max_price));
    if (filters?.max_weight_kg) qs.set('max_weight_kg', String(filters.max_weight_kg));
    return request<any[]>(`/jobs?${qs.toString()}`);
  },

  getJob: (id: string) => request<any>(`/jobs/${id}`),

  /**
   * Saját fuvarok.
   * - as='posted'   → amiket ÉN adtam fel
   * - as='assigned' → amiket ÉN teljesítek sofőrként
   */
  myJobs: (as: 'posted' | 'assigned' = 'posted') =>
    request<any[]>(`/jobs/mine/list?as=${as}`),

  /** Új fuvar létrehozása (feladói). */
  createJob: (body: {
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
  }) =>
    request<any>('/jobs', {
      method: 'POST',
      body: JSON.stringify(body),
    }),

  placeBid: (jobId: string, amount_huf: number, eta_minutes?: number, message?: string) =>
    request<any>(`/jobs/${jobId}/bids`, {
      method: 'POST',
      body: JSON.stringify({ amount_huf, eta_minutes, message }),
    }),

  /** A bejelentkezett sofőr saját licitjei (a kapcsolódó fuvar alap mezőivel). */
  myBids: () => request<any[]>('/bids/mine'),

  // ---------- Sofőri útvonal-hirdetés ----------

  createCarrierRoute: (body: any) =>
    request<any>('/carrier-routes', { method: 'POST', body: JSON.stringify(body) }),

  myCarrierRoutes: () => request<any[]>('/carrier-routes/mine'),

  listCarrierRoutes: (params?: { city?: string; from_date?: string; to_date?: string }) => {
    const qs = new URLSearchParams();
    if (params?.city) qs.set('city', params.city);
    if (params?.from_date) qs.set('from_date', params.from_date);
    if (params?.to_date) qs.set('to_date', params.to_date);
    const q = qs.toString();
    return request<any[]>(`/carrier-routes${q ? `?${q}` : ''}`);
  },

  getCarrierRoute: (id: string) => request<any>(`/carrier-routes/${id}`),

  setCarrierRouteStatus: (id: string, status: string) =>
    request<any>(`/carrier-routes/${id}/status`, {
      method: 'PATCH',
      body: JSON.stringify({ status }),
    }),

  /** Teljes útvonal szerkesztés (csak a tulajdonos hívhatja). */
  updateCarrierRoute: (id: string, body: any) =>
    request<any>(`/carrier-routes/${id}`, {
      method: 'PATCH',
      body: JSON.stringify(body),
    }),

  createRouteBooking: (routeId: string, body: any) =>
    request<any>(`/carrier-routes/${routeId}/bookings`, {
      method: 'POST',
      body: JSON.stringify(body),
    }),

  listRouteBookings: (routeId: string) =>
    request<any[]>(`/carrier-routes/${routeId}/bookings`),

  myRouteBookings: () => request<any[]>('/route-bookings/mine'),

  getRouteBooking: (id: string) => request<any>(`/route-bookings/${id}`),

  confirmRouteBooking: (id: string) =>
    request<any>(`/route-bookings/${id}/confirm`, { method: 'POST' }),

  rejectRouteBooking: (id: string) =>
    request<any>(`/route-bookings/${id}/reject`, { method: 'POST' }),

  /** Lusta Barion reservation – a "Fizetés Barionnal" gomb kattintáskor hívjuk. */
  payRouteBooking: (id: string) =>
    request<{ payment_id: string; gateway_url: string; is_stub: boolean; reused: boolean }>(
      `/route-bookings/${id}/pay`,
      { method: 'POST' },
    ),

  /** Sikeres STUB fizetés nyugtázása – paid_at beállítás + notif a sofőrnek. */
  confirmRouteBookingPayment: (id: string) =>
    request<{ ok: true; paid_at: string; already_paid?: boolean }>(
      `/route-bookings/${id}/confirm-payment`,
      { method: 'POST' },
    ),

  /** Licites fuvar: lusta Barion reservation. */
  payJob: (id: string) =>
    request<{ payment_id: string; gateway_url: string; is_stub: boolean; reused: boolean }>(
      `/jobs/${id}/pay`,
      { method: 'POST' },
    ),

  /** Licites fuvar: sikeres fizetés nyugtázása. */
  confirmJobPayment: (id: string) =>
    request<{ ok: true; paid_at: string; already_paid?: boolean }>(
      `/jobs/${id}/confirm-payment`,
      { method: 'POST' },
    ),

  /** Licites fuvar lemondása. */
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
      Object.fromEntries(Object.entries(params).filter(([, v]) => !!v)) as Record<string, string>,
    ).toString();
    return request<any[]>(`/messages?${qs}`);
  },

  // ---------- Reviews ----------

  submitReview: (body: { job_id?: string; booking_id?: string; stars: number; comment?: string }) =>
    request<any>('/reviews', { method: 'POST', body: JSON.stringify(body) }),

  getReviews: (params: { job_id?: string; booking_id?: string; user_id?: string }) => {
    const qs = new URLSearchParams(
      Object.fromEntries(Object.entries(params).filter(([, v]) => !!v)) as Record<string, string>,
    ).toString();
    return request<any[]>(`/reviews?${qs}`);
  },

  // ---------- Disputes ----------

  openDispute: (body: { job_id?: string; booking_id?: string; description: string; evidence_url?: string }) =>
    request<any>('/disputes', { method: 'POST', body: JSON.stringify(body) }),

  myDisputes: () => request<any[]>('/disputes/mine'),

  // ---------- Notifications ----------

  listNotifications: () => request<any[]>('/notifications'),

  unreadNotificationCount: () =>
    request<{ count: number }>('/notifications/unread-count'),

  markNotificationRead: (id: string) =>
    request<any>(`/notifications/${id}/read`, { method: 'POST' }),

  markAllNotificationsRead: () =>
    request<{ ok: true }>('/notifications/read-all', { method: 'POST' }),

  // ---------- AI chat ----------

  aiChat: (
    message: string,
    history: Array<{ role: 'user' | 'assistant'; content: string }>,
  ) =>
    request<{ reply: string }>('/ai/chat', {
      method: 'POST',
      body: JSON.stringify({ message, history }),
    }),

  /** Egy fuvar beérkezett licitjei. */
  listBids: (jobId: string) =>
    request<any[]>(`/jobs/${jobId}/bids`),

  /** Feladó elfogadja a licitet. */
  acceptBid: (bidId: string) =>
    request<{ ok: true; barion?: { gateway_url: string | null } }>(
      `/bids/${bidId}/accept`,
      { method: 'POST' },
    ),

  /** Egy fuvar fotói (listing + pickup + dropoff). */
  listPhotos: (jobId: string) =>
    request<any[]>(`/jobs/${jobId}/photos`),

  /** Pozíció ping a háttérből. */
  pingLocation: (jobId: string, lat: number, lng: number, speed_kmh?: number) =>
    request<{ ok: true }>(`/jobs/${jobId}/location`, {
      method: 'POST',
      body: JSON.stringify({ lat, lng, speed_kmh }),
    }),

  /**
   * Fotó feltöltése (pickup / dropoff). A fájlt lokális URI-ból
   * adjuk át — az Expo Camera ilyen formában adja vissza.
   *
   * A GPS mezők most opcionálisak: rögzítjük bizonyítékként, de a
   * dropoff validáció már a `delivery_code` alapján megy.
   * A delivery_code CSAK dropoff típusnál kötelező, és a feladótól
   * kapott 6 jegyű kódnak kell lennie.
   */
  uploadPhoto: async (params: {
    jobId: string;
    kind: 'pickup' | 'dropoff' | 'damage' | 'document';
    fileUri: string;
    fileName?: string;
    mimeType?: string;
    gps_lat?: number;
    gps_lng?: number;
    gps_accuracy_m?: number;
    delivery_code?: string;
  }) => {
    const form = new FormData();
    // @ts-expect-error – React Native FormData fájl objektum
    form.append('file', {
      uri: params.fileUri,
      name: params.fileName || 'photo.jpg',
      type: params.mimeType || 'image/jpeg',
    });
    form.append('kind', params.kind);
    if (params.gps_lat != null) form.append('gps_lat', String(params.gps_lat));
    if (params.gps_lng != null) form.append('gps_lng', String(params.gps_lng));
    if (params.gps_accuracy_m != null) {
      form.append('gps_accuracy_m', String(params.gps_accuracy_m));
    }
    if (params.delivery_code) form.append('delivery_code', params.delivery_code);

    const token = await getToken();
    const res = await fetch(`${BASE_URL}/jobs/${params.jobId}/photos`, {
      method: 'POST',
      headers: token ? { Authorization: `Bearer ${token}` } : undefined,
      body: form as any,
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({ error: res.statusText }));
      throw new Error(err.error || 'Feltöltés sikertelen');
    }
    return res.json();
  },
};
