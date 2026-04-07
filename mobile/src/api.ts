// Megosztott API kliens a mobil (Expo / React Native) alkalmazáshoz.
// Ugyanazokat a backend végpontokat hívja, mint a web kliens.
// A FormData a fotó-feltöltéshez React Native-ben natívan támogatott.

import AsyncStorage from '@react-native-async-storage/async-storage';

const BASE_URL =
  process.env.EXPO_PUBLIC_API_URL ?? 'http://localhost:4000';

async function getToken(): Promise<string | null> {
  return AsyncStorage.getItem('biztosfuvar_token');
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

  placeBid: (jobId: string, amount_huf: number, eta_minutes?: number, message?: string) =>
    request<any>(`/jobs/${jobId}/bids`, {
      method: 'POST',
      body: JSON.stringify({ amount_huf, eta_minutes, message }),
    }),

  /** Pozíció ping a háttérből. */
  pingLocation: (jobId: string, lat: number, lng: number, speed_kmh?: number) =>
    request<{ ok: true }>(`/jobs/${jobId}/location`, {
      method: 'POST',
      body: JSON.stringify({ lat, lng, speed_kmh }),
    }),

  /**
   * Fotó feltöltése (pickup / dropoff). A fájlt lokális URI-ból
   * adjuk át — az Expo Camera ilyen formában adja vissza.
   */
  uploadPhoto: async (params: {
    jobId: string;
    kind: 'pickup' | 'dropoff' | 'damage' | 'document';
    fileUri: string;
    fileName?: string;
    mimeType?: string;
    gps_lat: number;
    gps_lng: number;
    gps_accuracy_m?: number;
  }) => {
    const form = new FormData();
    // @ts-expect-error – React Native FormData fájl objektum
    form.append('file', {
      uri: params.fileUri,
      name: params.fileName || 'photo.jpg',
      type: params.mimeType || 'image/jpeg',
    });
    form.append('kind', params.kind);
    form.append('gps_lat', String(params.gps_lat));
    form.append('gps_lng', String(params.gps_lng));
    if (params.gps_accuracy_m != null) {
      form.append('gps_accuracy_m', String(params.gps_accuracy_m));
    }

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
