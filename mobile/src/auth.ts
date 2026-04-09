// Mobil auth helper – AsyncStorage-ból olvas, és role-érzékeny redirect-et ad.
//
// Az auth állapot változását a globális `DeviceEventEmitter`-en keresztül
// hirdetjük ki (`gofuvar:auth` event). Így bárhol az app-ban lehet rá
// feliratkozni (pl. a globális notifikáció-toast listener) anélkül, hogy
// context provider vagy prop drilling kellene.
import AsyncStorage from '@react-native-async-storage/async-storage';
import { DeviceEventEmitter } from 'react-native';

export type Role = 'shipper' | 'carrier' | 'admin';

export type CurrentUser = {
  id: string;
  email: string;
  role: Role;
  full_name?: string;
};

export const AUTH_EVENT = 'gofuvar:auth';

export async function setCurrentUser(user: CurrentUser, token: string) {
  await AsyncStorage.setItem('gofuvar_user', JSON.stringify(user));
  await AsyncStorage.setItem('gofuvar_token', token);
  DeviceEventEmitter.emit(AUTH_EVENT);
}

export async function clearCurrentUser() {
  await AsyncStorage.removeItem('gofuvar_user');
  await AsyncStorage.removeItem('gofuvar_token');
  DeviceEventEmitter.emit(AUTH_EVENT);
}

export async function getCurrentUser(): Promise<CurrentUser | null> {
  const raw = await AsyncStorage.getItem('gofuvar_user');
  if (!raw) return null;
  try {
    return JSON.parse(raw) as CurrentUser;
  } catch {
    return null;
  }
}

/**
 * A login utáni alapértelmezett kezdőoldal a user role-ja alapján.
 * Mindenki a hub-ra érkezik, onnan választ menüpontot.
 */
export function homeForRole(role: Role): string {
  return '/hub';
}
