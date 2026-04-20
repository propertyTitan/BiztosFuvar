// =====================================================================
//  Háttér GPS tracking — lezárt képernyőnél is működik.
//
//  Az Expo TaskManager + Location.startLocationUpdatesAsync segítségével
//  a sofőr telefonja akkor is küldi a GPS pozíciót, ha:
//    - az app háttérben van (app switcher)
//    - a képernyő le van zárva
//    - más appot használ
//
//  A task globálisan regisztrálva van (nem komponens szinten), így az
//  app induláskor azonnal aktív. Az indítás/leállítás a fuvar
//  részletek oldalról történik.
// =====================================================================

import * as Location from 'expo-location';
import * as TaskManager from 'expo-task-manager';
import AsyncStorage from '@react-native-async-storage/async-storage';

const TASK_NAME = 'GOFUVAR_BACKGROUND_TRACKING';
const STORAGE_KEY = 'gofuvar_bg_tracking_job_id';
const STORAGE_DROPOFF_KEY = 'gofuvar_bg_tracking_dropoff';
const NORMAL_INTERVAL = 60000;   // 60 mp — normál mód
const CLOSE_INTERVAL = 15000;    // 15 mp — 5 km-en belül
const CLOSE_THRESHOLD_M = 5000;  // 5 km = váltás pontos módra

// API base URL — ugyanaz mint az api.ts-ben
const BASE_URL = process.env.EXPO_PUBLIC_API_URL ?? 'http://localhost:4000';

// Haversine távolság méterben
function distanceM(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const R = 6371000;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLng = ((lng2 - lng1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((lat1 * Math.PI) / 180) * Math.cos((lat2 * Math.PI) / 180) *
    Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

// A task handler: minden GPS frissítésnél meghívódik
TaskManager.defineTask(TASK_NAME, async ({ data, error }: any) => {
  if (error) {
    console.warn('[bg-tracking] task error:', error.message);
    return;
  }
  if (!data?.locations?.length) return;

  const location = data.locations[0];
  const { latitude, longitude, speed } = location.coords;

  try {
    const jobId = await AsyncStorage.getItem(STORAGE_KEY);
    const token = await AsyncStorage.getItem('gofuvar_token');
    if (!jobId || !token) return;

    await fetch(`${BASE_URL}/jobs/${jobId}/location`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({
        lat: latitude,
        lng: longitude,
        speed_kmh: speed != null ? speed * 3.6 : undefined,
      }),
    });

    // Dinamikus frekvencia: ha 5 km-en belül a dropoff → gyorsítunk 15 mp-re
    const dropoffJson = await AsyncStorage.getItem(STORAGE_DROPOFF_KEY);
    if (dropoffJson) {
      const dropoff = JSON.parse(dropoffJson);
      const dist = distanceM(latitude, longitude, dropoff.lat, dropoff.lng);
      const isClose = dist <= CLOSE_THRESHOLD_M;
      const isRunning = await Location.hasStartedLocationUpdatesAsync(TASK_NAME).catch(() => false);
      if (isRunning && isClose) {
        // Újraindítjuk rövidebb intervallummal (idempotens — ha már 15 mp, nem változik)
        await Location.stopLocationUpdatesAsync(TASK_NAME);
        await Location.startLocationUpdatesAsync(TASK_NAME, {
          accuracy: Location.Accuracy.High,
          timeInterval: CLOSE_INTERVAL,
          showsBackgroundLocationIndicator: true,
          foregroundService: {
            notificationTitle: 'GoFuvar — Hamarosan célnál!',
            notificationBody: 'Pontos pozíció küldése a feladónak.',
            notificationColor: '#FB8C00',
          },
        });
        console.log(`[bg-tracking] GYORSÍTÁS: ${Math.round(dist)}m a céltól → 15mp intervallum`);
      }
    }
  } catch (err: any) {
    console.warn('[bg-tracking] ping error:', err.message);
  }
});

/**
 * Háttér tracking indítása egy adott fuvarhoz.
 * Kéri a háttér-helymeghatározás engedélyt ha még nincs meg.
 * @param dropoffLat — a lerakási pont lat (közelség-alapú gyorsításhoz)
 * @param dropoffLng — a lerakási pont lng
 */
export async function startBackgroundTracking(
  jobId: string,
  dropoffLat?: number,
  dropoffLng?: number,
): Promise<boolean> {
  // Előtér engedély (alap)
  const { status: fg } = await Location.requestForegroundPermissionsAsync();
  if (fg !== 'granted') return false;

  // Háttér engedély (ez a fontos!)
  const { status: bg } = await Location.requestBackgroundPermissionsAsync();
  if (bg !== 'granted') {
    console.warn('[bg-tracking] háttér engedély megtagadva');
    return false;
  }

  // Már fut?
  const isRunning = await Location.hasStartedLocationUpdatesAsync(TASK_NAME).catch(() => false);
  if (isRunning) {
    // Frissítjük a job ID-t (ha másik fuvarra váltott)
    await AsyncStorage.setItem(STORAGE_KEY, jobId);
    return true;
  }

  // Job ID + dropoff mentése — a task handler ebből olvassa
  await AsyncStorage.setItem(STORAGE_KEY, jobId);
  if (dropoffLat != null && dropoffLng != null) {
    await AsyncStorage.setItem(STORAGE_DROPOFF_KEY, JSON.stringify({ lat: dropoffLat, lng: dropoffLng }));
  }

  await Location.startLocationUpdatesAsync(TASK_NAME, {
    accuracy: Location.Accuracy.Balanced,
    timeInterval: NORMAL_INTERVAL,
    showsBackgroundLocationIndicator: true, // iOS: kék sáv felül
    foregroundService: {
      notificationTitle: 'GoFuvar — Élő követés',
      notificationBody: 'A pozíciódat küldjük a feladónak.',
      notificationColor: '#2E7D32',
    },
  });

  console.log(`[bg-tracking] indítva: job=${jobId}`);
  return true;
}

/**
 * Háttér tracking leállítása.
 */
export async function stopBackgroundTracking(): Promise<void> {
  const isRunning = await Location.hasStartedLocationUpdatesAsync(TASK_NAME).catch(() => false);
  if (isRunning) {
    await Location.stopLocationUpdatesAsync(TASK_NAME);
    console.log('[bg-tracking] leállítva');
  }
  await AsyncStorage.removeItem(STORAGE_KEY);
  await AsyncStorage.removeItem(STORAGE_DROPOFF_KEY);
}

/**
 * Ellenőrzi, hogy fut-e a háttér tracking.
 */
export async function isBackgroundTrackingActive(): Promise<boolean> {
  return Location.hasStartedLocationUpdatesAsync(TASK_NAME).catch(() => false);
}
