// Next.js 14 instrumentation hook — itt töltjük be a Sentry-t a megfelelő
// futási környezetben (node vs edge).
export async function register() {
  if (process.env.NEXT_RUNTIME === 'nodejs') {
    await import('./sentry.server.config');
  }
}
