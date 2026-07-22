// Sentry kliens-oldali init.
// Csak akkor aktivál, ha NEXT_PUBLIC_SENTRY_DSN env meg van adva.
import * as Sentry from '@sentry/nextjs';
import { scrubSentryEvent } from '@/lib/sentryScrub';

if (process.env.NEXT_PUBLIC_SENTRY_DSN) {
  Sentry.init({
    dsn: process.env.NEXT_PUBLIC_SENTRY_DSN,
    environment: process.env.NEXT_PUBLIC_ENV || process.env.NODE_ENV,
    tracesSampleRate: 0.1,
    replaysSessionSampleRate: 0.0,
    replaysOnErrorSampleRate: 0.1,
    // PII-szűrés: request body eldobása, token-paraméterek kitakarása
    // (jelszó-reset / email-verify URL-tokenek!), auth-fejlécek törlése —
    // részletek: src/lib/sentryScrub.ts
    beforeSend: scrubSentryEvent,
  });
}
