// Next.js 14 instrumentation hook — itt töltjük be a Sentry-t a megfelelő
// futási környezetben (node vs edge).
//
// FONTOS: a sentry.client.config.ts a kliens-oldali init, a NEXT_PUBLIC_*
// env-eket onnan használja. Itt csak a server / edge oldali Sentry-t
// inicializáljuk.

export async function register() {
  if (process.env.NEXT_RUNTIME === 'nodejs') {
    await import('./sentry.server.config');
  }
}
