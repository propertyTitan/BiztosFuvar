// Külső HTTP-hívások közös időkerete (2026-09-13, teljes audit D4).
// A Resend, a SeeMe és az Expo push hívása időkeret NÉLKÜL ment: egy
// TCP-szinten elfogadott, de nem válaszoló szolgáltatásnál a Node/undici
// 300 mp-es alapértelmezése volt az egyetlen fék — az e-mail újrapróbával
// ~15 perc egyetlen levélre, végig egy `await` mögött, ami a napi köröket
// (soros küldés) órákra megállította. Minden kísérlet külön keretet kap.
const ALAP_MS = 10_000;

function kulsoHivasIdokeretMs() {
  const n = Number(process.env.KULSO_HTTP_TIMEOUT_MS);
  return Number.isFinite(n) && n > 0 ? n : ALAP_MS;
}

/** AbortSignal a fetch `signal` opciójához — hívásonként új példány. */
function kulsoHivasSignal(ms = kulsoHivasIdokeretMs()) {
  return AbortSignal.timeout(ms);
}

module.exports = { kulsoHivasSignal, kulsoHivasIdokeretMs, ALAP_MS };
