// Sentry kliens-oldali init.
// Csak akkor aktivál, ha NEXT_PUBLIC_SENTRY_DSN env meg van adva.
import * as Sentry from '@sentry/nextjs';
import { scrubSentryEvent, scrubSentrySpan, scrubSentryTransaction } from '@/lib/sentryScrub';

if (process.env.NEXT_PUBLIC_SENTRY_DSN) {
  Sentry.init({
    dsn: process.env.NEXT_PUBLIC_SENTRY_DSN,
    environment: process.env.NEXT_PUBLIC_ENV || process.env.NODE_ENV,
    tracesSampleRate: 0.1,
    // ⚠️ SESSION REPLAY SZÁNDÉKOSAN NINCS (2026-08-09, adatvédelmi audit).
    // Korábban itt `replaysOnErrorSampleRate: 0.1` állt — ami FÉLREVEZETŐ
    // volt: a `replayIntegration` sem a böngésző-SDK, sem a Next.js-réteg
    // alapértelmezett integrációi közt nincs benne (ellenőrizve a telepített
    // csomag `getDefaultIntegrations`-ében), tehát felvétel SOSEM készült.
    // A mintavételi arány viszont azt sugallta, hogy fut — és ha valaki
    // emiatt „rendesen bekapcsolja", azzal a felhasználó képernyőjéről
    // készülne felvétel, amire a `beforeSend` NEM fut (a replay külön
    // csatornán megy). Ezért a sorokat kivettük: ha valaha kell, tudatos
    // döntés legyen, adatkezelési tájékoztatóval együtt.
    // PII-szűrés: request body eldobása, token-paraméterek kitakarása
    // (jelszó-reset / email-verify URL-tokenek!), auth-fejlécek törlése —
    // részletek: src/lib/sentryScrub.ts
    // ⚠️ CONSOLE-BREADCRUMB KIKAPCSOLVA (2026-08-11, adatáramlási audit).
    // A Sentry `consoleIntegration`-je ALAPÉRTELMEZÉS SZERINT BE VAN
    // KAPCSOLVA: minden `console.log/warn/error` szövege breadcrumbként
    // felkerül a következő hibaeseményre. Élő út volt rá, ami nyers
    // e-mail-címet vitt ki a böngészőből. A PII-szűrő ma már ezt is takarja,
    // de a helyes sorrend: NE IS keletkezzen. (A backend ugyanezt teszi.)
    integrations: (alap) => alap.filter((i) => i.name !== 'Console'),
    beforeSend: scrubSentryEvent,
    // Mind a három boríték — a beforeSend csak a HIBA-eseményre fut.
    beforeSendSpan: scrubSentrySpan,
    beforeSendTransaction: scrubSentryTransaction,
  });
}
