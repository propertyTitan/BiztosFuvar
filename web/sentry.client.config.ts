// Sentry kliens-oldali init.
// Csak akkor aktivál, ha NEXT_PUBLIC_SENTRY_DSN env meg van adva.
//
// Bizalmas adatok kiszűrése: a localStorage és cookie-k automatikusan
// kimaradnak; ha bármi mást szeretnénk anonimizálni, a `beforeSend`-ben
// kell.
import * as Sentry from '@sentry/nextjs';

if (process.env.NEXT_PUBLIC_SENTRY_DSN) {
  Sentry.init({
    dsn: process.env.NEXT_PUBLIC_SENTRY_DSN,
    environment: process.env.NEXT_PUBLIC_ENV || process.env.NODE_ENV,
    tracesSampleRate: 0.1,
    replaysSessionSampleRate: 0.0, // session replay-t később kapcsoljuk be
    replaysOnErrorSampleRate: 0.1,
    beforeSend(event) {
      // Authorization header / token soha ne menjen ki
      if (event.request?.headers) {
        delete (event.request.headers as any).authorization;
        delete (event.request.headers as any).cookie;
      }
      return event;
    },
  });
}
