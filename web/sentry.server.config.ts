// Sentry szerveroldali init Next.js-hez.
import * as Sentry from '@sentry/nextjs';
import { scrubSentryEvent } from '@/lib/sentryScrub';

if (process.env.SENTRY_DSN || process.env.NEXT_PUBLIC_SENTRY_DSN) {
  Sentry.init({
    dsn: process.env.SENTRY_DSN || process.env.NEXT_PUBLIC_SENTRY_DSN,
    environment: process.env.NODE_ENV,
    tracesSampleRate: 0.1,
    // PII-szűrés — eddig itt SEMMILYEN beforeSend nem volt (a fejléc-szűrés
    // is hiányzott); részletek: src/lib/sentryScrub.ts
    beforeSend: scrubSentryEvent,
  });
}
