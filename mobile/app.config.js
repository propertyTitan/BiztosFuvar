// BiztosFuvar – Expo dinamikus konfiguráció.
// A Google Maps API kulcsot env-ből olvassuk, hogy ne kerüljön a git-be.
// Expo SDK 49+ automatikusan betölti a `mobile/.env` fájlt.
//
// Szükséges env változók:
//   GOOGLE_MAPS_API_KEY     – iOS és Android natív Maps SDK
//   EXPO_PUBLIC_API_URL     – backend URL (pl. http://192.168.x.x:4000)
//   EXPO_PUBLIC_GOOGLE_MAPS_KEY – ugyanaz mint fent, JS oldalra is exponálva

const GOOGLE_MAPS_KEY =
  process.env.GOOGLE_MAPS_API_KEY ||
  process.env.EXPO_PUBLIC_GOOGLE_MAPS_KEY ||
  '';

module.exports = {
  expo: {
    name: 'BiztosFuvar',
    slug: 'biztosfuvar',
    version: '0.1.0',
    orientation: 'portrait',
    scheme: 'biztosfuvar',
    userInterfaceStyle: 'automatic',
    newArchEnabled: true,

    ios: {
      supportsTablet: true,
      bundleIdentifier: 'hu.biztosfuvar.app',
      // react-native-maps Google provider iOS-en
      config: {
        googleMapsApiKey: GOOGLE_MAPS_KEY,
      },
      infoPlist: {
        NSCameraUsageDescription:
          'A BiztosFuvar a fuvarhoz tartozó fotók készítéséhez használja a kamerát.',
        NSLocationWhenInUseUsageDescription:
          'A BiztosFuvar a fuvar lezárásakor ellenőrzi, hogy a célhelyen vagy.',
        NSLocationAlwaysAndWhenInUseUsageDescription:
          'Élő követéshez háttérben is használjuk a helyzetedet.',
      },
    },

    android: {
      package: 'hu.biztosfuvar.app',
      permissions: [
        'CAMERA',
        'ACCESS_FINE_LOCATION',
        'ACCESS_COARSE_LOCATION',
      ],
      // react-native-maps Google provider Androidon
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
            'A BiztosFuvar a fuvarhoz tartozó fotók készítéséhez használja a kamerát.',
        },
      ],
      [
        'expo-location',
        {
          locationAlwaysAndWhenInUsePermission:
            'A BiztosFuvar a fuvar lezárásához használja a GPS-t.',
        },
      ],
    ],

    extra: {
      apiUrl: process.env.EXPO_PUBLIC_API_URL || 'http://localhost:4000',
      googleMapsApiKey: GOOGLE_MAPS_KEY,
    },
  },
};
