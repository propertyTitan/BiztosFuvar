/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  env: {
    NEXT_PUBLIC_API_URL: process.env.NEXT_PUBLIC_API_URL || 'http://localhost:4000',
    NEXT_PUBLIC_GOOGLE_MAPS_KEY: process.env.NEXT_PUBLIC_GOOGLE_MAPS_KEY || '',
  },
  // ── Biztonsági fejlécek (SEC-001/002, Manus biztonsági audit 2026-08-31) ──
  //
  // SEC-001 (clickjacking): az oldal iframe-be volt tölthető — a
  // `frame-ancestors 'none'` + `X-Frame-Options: DENY` páros zárja (a CSP a
  // modern, az XFO a régi böngészőknek).
  //
  // ⚠️ TELJES (script-src-es) CSP itt SZÁNDÉKOSAN NINCS: az inline stílusok,
  // a Google Maps és a Socket.IO miatt az gondos tervezést kér — a
  // SEC-003-as session-átépítési körhöz tartozik, nem gyorsjavítás.
  //
  // Permissions-Policy: a geolocation-t az oldal maga használja (SOS,
  // élő követés) — az marad self; kamera/mikrofon soha nem kell.
  async headers() {
    return [
      {
        source: '/:path*',
        headers: [
          { key: 'Content-Security-Policy', value: "frame-ancestors 'none'" },
          { key: 'X-Frame-Options', value: 'DENY' },
          { key: 'X-Content-Type-Options', value: 'nosniff' },
          { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
          { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=(self)' },
        ],
      },
    ];
  },
};
module.exports = nextConfig;
