// Playwright E2E — valódi böngésző a teljes stack ellen:
//   beágyazott Postgres (54332) ← backend (4100) ← Next.js dev (3100)
//
// A globalSetup indítja a teszt-Postgrest (a backend/tests/pg-server.js
// közös moduljával), a webServer szekció pedig a backendet + a webet.
// A backend env-je kényszerítve a teszt-DB-re mutat — a prod Neont E2E
// teszt SOHA nem éri el. Minden külső kulcs üres → stub-mód (Barion/SMS/
// email csak logol). A Google Maps kulcs valódi (web/.env.local ill. CI
// secret), mert a cím-keresés a Places widgettel élesben megy.
import { defineConfig } from '@playwright/test';

const E2E_DB_URL = 'postgres://gofuvar:gofuvar@127.0.0.1:54332/gofuvar_test';

export default defineConfig({
  testDir: './e2e',
  globalSetup: './e2e/global-setup.ts',
  timeout: 90_000,
  expect: { timeout: 15_000 },
  // Egy DB-n és egy realtime (Socket.IO) szerveren osztozunk → szekvenciális
  fullyParallel: false,
  workers: 1,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [['github'], ['list']] : [['list']],
  use: {
    baseURL: 'http://localhost:3100',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    locale: 'hu-HU',
  },
  webServer: [
    {
      command: 'node src/index.js',
      cwd: '../backend',
      url: 'http://localhost:4100/health',
      timeout: 60_000,
      reuseExistingServer: !process.env.CI,
      env: {
        DATABASE_URL: E2E_DB_URL,
        PORT: '4100',
        NODE_ENV: 'test',
        JWT_SECRET: 'e2e-jwt-titok-nem-eles',
        SEEME_API_KEY: '',
        RESEND_API_KEY: '',
        BARION_POSKEY: '',
        SENTRY_DSN: '',
        GEMINI_API_KEY: '',
        R2_ACCESS_KEY_ID: '',
        R2_SECRET_ACCESS_KEY: '',
      },
    },
    {
      command: 'npx next dev -p 3100',
      url: 'http://localhost:3100',
      timeout: 120_000,
      reuseExistingServer: !process.env.CI,
      env: {
        NEXT_PUBLIC_API_URL: 'http://localhost:4100',
      },
    },
  ],
});
