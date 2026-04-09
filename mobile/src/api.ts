// Megosztott API kliens a mobil (Expo / React Native) alkalmazáshoz.
// Ugyanazokat a backend végpontokat hívja, mint a web kliens.
// A FormData a fotó-feltöltéshez React Native-ben natívan támogatott.

import AsyncStorage from '@react-native-async-storage/async-storage';

const BASE_URL =
  process.env.EXPO_PUBLIC_API_URL ?? 'http://localhost:4000';

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

  const res = await fetch(`${BASE_URL}${path}`, { ...init, headers });
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

  /** Licitálható fuvarok közelség szerint. */
  nearbyJobs: (lat: number, lng: number, radiusKm = 50) => {
    const qs = new URLSearchParams({
      status: 'bidding',
      lat: String(lat),
      lng: String(lng),
      radius_km: String(radiusKm),
    });
    return request<any[]>(`/jobs?${qs.toString()}`);
  },

  getJob: (id: string) => request<any>(`/jobs/${id}`),

  /** Saját fuvarok – backend a szerepkör alapján szűr. */
  myJobs: () => request<any[]>('/jobs/mine/list'),

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

  listCarrierRoutes: (city?: string) => {
    const qs = city ? `?city=${encodeURIComponent(city)}` : '';
    return request<any[]>(`/carrier-routes${qs}`);
  },

  getCarrierRoute: (id: string) => request<any>(`/carrier-routes/${id}`),

  setCarrierRouteStatus: (id: string, status: string) =>
    request<any>(`/carrier-routes/${id}/status`, {
      method: 'PATCH',
      body: JSON.stringify({ status }),
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
