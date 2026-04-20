// GoFuvar – Expo dinamikus konfiguráció.
// A Google Maps API kulcsot env-ből olvassuk, hogy ne kerüljön a git-be.
// Expo SDK 49+ automatikusan betölti a `mobile/.env` fájlt.
//
// Szükséges env változók:
//   GOOGLE_MAPS_API_KEY         – iOS és Android natív Maps SDK
//   EXPO_PUBLIC_API_URL         – backend URL (pl. http://192.168.x.x:4000)
//   EXPO_PUBLIC_GOOGLE_MAPS_KEY – ugyanaz mint fent, JS oldalra is exponálva

const GOOGLE_MAPS_KEY =
  process.env.GOOGLE_MAPS_API_KEY ||
  process.env.EXPO_PUBLIC_GOOGLE_MAPS_KEY ||
  '';

module.exports = {
  expo: {
    name: 'GoFuvar',
    slug: 'gofuvar',
    version: '0.2.0',
    orientation: 'portrait',
    scheme: 'gofuvar',
    userInterfaceStyle: 'automatic',
    newArchEnabled: true,

    ios: {
      supportsTablet: true,
      bundleIdentifier: 'hu.gofuvar.app',
      config: {
        googleMapsApiKey: GOOGLE_MAPS_KEY,
      },
      infoPlist: {
        NSCameraUsageDescription:
          'A GoFuvar a fuvarhoz tartozó fotók készítéséhez használja a kamerát.',
        NSLocationWhenInUseUsageDescription:
          'A GoFuvar a fuvar lezárásakor ellenőrzi, hogy a célhelyen vagy.',
        NSLocationAlwaysAndWhenInUseUsageDescription:
          'Élő követéshez háttérben is használjuk a helyzetedet.',
      },
    },

    android: {
      package: 'hu.gofuvar.app',
      permissions: [
        'CAMERA',
        'ACCESS_FINE_LOCATION',
        'ACCESS_COARSE_LOCATION',
        'ACCESS_BACKGROUND_LOCATION',
        'FOREGROUND_SERVICE',
        'FOREGROUND_SERVICE_LOCATION',
      ],
      config: {
        googleMaps: {
          apiKey: GOOGLE_MAPS_KEY,
        },
      },
    },

    plugins: [
      'expo-router',
      [
        'expo-camera',
        {
          cameraPermission:
            'A GoFuvar a fuvarhoz tartozó fotók készítéséhez használja a kamerát.',
        },
      ],
      [
        'expo-location',
        {
          locationAlwaysAndWhenInUsePermission:
            'A GoFuvar az élő csomag-követéshez használja a GPS-t, hogy a feladó lássa hol jársz — lezárt képernyőnél is.',
          isAndroidBackgroundLocationEnabled: true,
          isAndroidForegroundServiceEnabled: true,
        },
      ],
    ],

    extra: {
      apiUrl: process.env.EXPO_PUBLIC_API_URL || 'http://localhost:4000',
      googleMapsApiKey: GOOGLE_MAPS_KEY,
    },
  },
};
