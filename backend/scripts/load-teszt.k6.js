// =====================================================================
//  k6 terheléses forgatókönyv — GoFuvar prod API (api.gofuvar.hu)
//
//  NEM önállóan fut: a `load-teszt.js` orchestrator indítja, ami előbb
//  létrehozza a teszt-adatokat (fuvar tracking-tokennel + usereket), a
//  végén pedig kitakarítja. Az adatokat env-ben kapja (LOAD_* változók).
//
//  ⚠️ A méréshez tudni kell: a backend globális rate limitje 300 kérés/
//  perc/IP (= 5 rps). Mivel a load-teszt EGY IP-ről megy, a valós
//  szerver-kapacitást csak a limit ALATT lehet tisztán mérni — a limit
//  FÖLÖTT a 429 az ELVÁRT válasz (a védelem áll), nem hiba. Ezért a három
//  szakasz szekvenciálisan fut, és a rate-limit-próba külön értékelődik.
//
//  Szakaszok (startTime-mal egymás után):
//   1. cold_start   — 1 kérés, a hideg (Neon-alvásból ébredő) latencia
//   2. bongeszes    — 4 rps, 50s, a limit ALATT: valós latencia + hibaarány
//   3. auth_bongeszes — 3 rps, 30s, bejelentkezett GET-ek (token kell)
//   4. rate_limit   — 2→15 rps rámpa: a limiter 429-cel véd-e (nem 5xx)
// =====================================================================

import http from 'k6/http';
import { check } from 'k6';
import { Counter, Trend } from 'k6/metrics';

const API = __ENV.LOAD_API || 'https://api.gofuvar.hu';
const TRACKING = __ENV.LOAD_TRACKING_TOKEN;
const TOKENS = (__ENV.LOAD_TOKENS || '').split(',').filter(Boolean);

// Publikus GET-ek — reprezentatív böngészési keverék (statikus + DB-olvasó)
const BP = { lat: 47.4979, lng: 19.0402 };
const SZEGED = { lat: 46.2530, lng: 20.1414 };
const CALC_Q = `pickup_lat=${BP.lat}&pickup_lng=${BP.lng}&dropoff_lat=${SZEGED.lat}&dropoff_lng=${SZEGED.lng}&weight_kg=12`;

// Saját metrikák szakaszonként (a http_req_failed a 429-et is hibának
// venné — nekünk a 429 a rate-limit-szakaszban ELVÁRT, ezért külön mérünk)
const c2xx = new Counter('gf_2xx');
const c429 = new Counter('gf_429');
const c4xx = new Counter('gf_4xx_egyeb');
const c5xx = new Counter('gf_5xx');
const coldStart = new Trend('gf_cold_start_ms', true);
const dbRead = new Trend('gf_db_read_ms', true); // /tracking DB-olvasás latenciája

export const options = {
  scenarios: {
    cold_start: {
      executor: 'per-vu-iterations',
      vus: 1, iterations: 1, startTime: '0s', maxDuration: '15s',
      exec: 'coldStartHit', tags: { szakasz: 'cold_start' },
    },
    bongeszes: {
      executor: 'constant-arrival-rate',
      rate: 4, timeUnit: '1s', duration: '50s',
      preAllocatedVUs: 20, maxVUs: 40, startTime: '16s',
      exec: 'publikusBongeszes', tags: { szakasz: 'bongeszes' },
    },
    auth_bongeszes: {
      executor: 'constant-arrival-rate',
      rate: 3, timeUnit: '1s', duration: '30s',
      preAllocatedVUs: 15, maxVUs: 30, startTime: '70s',
      exec: 'authBongeszes', tags: { szakasz: 'auth' },
    },
    rate_limit: {
      // Egyetlen agresszív burst EGY 60s-os limiter-ablakon belül, hogy
      // garantáltan túllépje a 300/perc plafont (a korábbi lassú rámpa két
      // ablakra oszlott, és egyik sem érte el a 300-at → nem bizonyított).
      // ~55 rps × 12s ≈ 660 kérés » 300 → a fölöslegnek 429-et kell kapnia.
      executor: 'constant-arrival-rate',
      rate: 55, timeUnit: '1s', duration: '12s',
      preAllocatedVUs: 60, maxVUs: 120, startTime: '105s',
      exec: 'rateLimitProba', tags: { szakasz: 'rate_limit' },
    },
  },
  // A percentilisek explicit kérése — enélkül a k6 nem számol p99-et (0 lenne).
  summaryTrendStats: ['avg', 'med', 'p(95)', 'p(99)', 'max'],
  thresholds: {
    // A böngészés (limit alatt) SOHA ne adjon 5xx-et, és a p95 legyen józan.
    'http_req_duration{szakasz:bongeszes}': ['p(95)<1500', 'p(99)<3000'],
    // Az auth-szakasz duration deklarálása kell, hogy a submetrika a
    // summary-be kerüljön (enélkül a riportban 0-ként jelenne meg).
    'http_req_duration{szakasz:auth}': ['p(95)<2000'],
    'gf_5xx': ['count<1'],            // NULLA szerverhiba az egész futásban
    'http_req_failed{szakasz:bongeszes}': ['rate<0.01'],
    // A rate-limit-próbának ténylegesen fékeznie KELL (nem üres teszt).
    'gf_429': ['count>50'],
  },
};

function szamol(res) {
  const s = res.status;
  if (s >= 200 && s < 300) c2xx.add(1);
  else if (s === 429) c429.add(1);
  else if (s >= 500) c5xx.add(1);
  else c4xx.add(1);
  return s;
}

export function coldStartHit() {
  // A legelső DB-olvasás — ha a Neon aludt, itt látszik az ébredés ára
  const res = http.get(`${API}/tracking/${TRACKING}`, { tags: { nev: 'cold' } });
  coldStart.add(res.timings.duration);
  szamol(res);
  check(res, { 'cold start nem 5xx': (r) => r.status < 500 });
}

export function publikusBongeszes() {
  // Súlyozott keverék: a legtöbb kérés böngészés-jellegű GET
  const r = Math.random();
  let res;
  if (r < 0.35) {
    res = http.get(`${API}/calculator/estimate?${CALC_Q}`, { tags: { nev: 'calc' } });
  } else if (r < 0.6) {
    res = http.get(`${API}/coverage/zones`, { tags: { nev: 'coverage' } });
  } else if (r < 0.85) {
    res = http.get(`${API}/tracking/${TRACKING}`, { tags: { nev: 'tracking' } });
    dbRead.add(res.timings.duration);
  } else {
    res = http.get(`${API}/health`, { tags: { nev: 'health' } });
  }
  szamol(res);
  check(res, { 'böngészés 2xx': (r) => r.status >= 200 && r.status < 300 });
}

export function authBongeszes() {
  if (TOKENS.length === 0) return;
  const token = TOKENS[Math.floor(Math.random() * TOKENS.length)];
  const params = { headers: { Authorization: `Bearer ${token}` } };
  const r = Math.random();
  let res;
  if (r < 0.4) res = http.get(`${API}/auth/me`, { ...params, tags: { nev: 'me' } });
  else if (r < 0.7) res = http.get(`${API}/jobs/`, { ...params, tags: { nev: 'jobs' } });
  else res = http.get(`${API}/notifications`, { ...params, tags: { nev: 'notif' } });
  szamol(res);
  check(res, { 'auth GET 2xx': (r) => r.status >= 200 && r.status < 300 });
}

export function rateLimitProba() {
  // Szándékosan a limit fölé megyünk. A HELYES válasz 2xx VAGY 429 —
  // az 5xx az egyetlen valódi hiba (a limiternek nem szabad összeomlania).
  // ⚠️ A /calculator/estimate a globalRateLimit MÖGÖTT van (a /coverage és
  // /health SZÁNDÉKOSAN előtte — azok nem limiteltek), ezért a limiter-
  // igazoláshoz EZT a végpontot lőjük. Egyedi query, hogy semmi ne cache-elje.
  const res = http.get(`${API}/calculator/estimate?${CALC_Q}&_=${Math.random()}`, { tags: { nev: 'rl' } });
  szamol(res);
  check(res, { 'rate-limit alatt sosem 5xx': (r) => r.status < 500 });
}

export function handleSummary(data) {
  const m = data.metrics;
  const val = (name, stat) => (m[name] && m[name].values[stat] != null ? m[name].values[stat] : 0);
  const round = (n) => Math.round(n * 10) / 10;

  const s2 = val('gf_2xx', 'count');
  const s429 = val('gf_429', 'count');
  const s4 = val('gf_4xx_egyeb', 'count');
  const s5 = val('gf_5xx', 'count');
  const osszes = s2 + s429 + s4 + s5;

  const sor = (cimke, ertek) => `  ${cimke.padEnd(38)} ${ertek}`;
  const out = [
    '',
    '========== GoFuvar terheléses teszt — összegzés ==========',
    '',
    'VÁLASZKÓD-ELOSZLÁS (teljes futás):',
    sor('2xx (sikeres):', `${s2}  (${round(100 * s2 / osszes)}%)`),
    sor('429 (rate-limit — a védelem áll):', `${s429}  (${round(100 * s429 / osszes)}%)`),
    sor('4xx egyéb:', `${s4}`),
    sor('5xx (SZERVERHIBA):', `${s5}   ${s5 === 0 ? '✅' : '❌ VIZSGÁLD!'}`),
    '',
    'LATENCIA — böngészés (rate-limit ALATT, valós kapacitás):',
    sor('p50:', `${round(val('http_req_duration{szakasz:bongeszes}', 'med'))} ms`),
    sor('p95:', `${round(val('http_req_duration{szakasz:bongeszes}', 'p(95)'))} ms`),
    sor('p99:', `${round(val('http_req_duration{szakasz:bongeszes}', 'p(99)'))} ms`),
    sor('átlag:', `${round(val('http_req_duration{szakasz:bongeszes}', 'avg'))} ms`),
    sor('max:', `${round(val('http_req_duration{szakasz:bongeszes}', 'max'))} ms`),
    '',
    'RÉSZLETEK:',
    sor('Cold start (első DB-olvasás):', `${round(val('gf_cold_start_ms', 'avg'))} ms`),
    sor('DB-olvasás /tracking p95:', `${round(val('gf_db_read_ms', 'p(95)'))} ms`),
    sor('Auth GET p95 (belépve):', `${round(val('http_req_duration{szakasz:auth}', 'p(95)'))} ms`),
    '',
    'ÉRTÉKELÉS:',
    sor('Szerverhiba (5xx):', s5 === 0 ? '✅ NULLA — stabil terhelés alatt' : `❌ ${s5} db`),
    sor('Rate-limit védelem:', s429 > 0 ? `✅ aktív (${s429} kérést fékezett)` : 'ℹ️ nem lépte át a limitet'),
    '==========================================================',
    '',
  ].join('\n');

  return {
    stdout: out,
    [`${__ENV.LOAD_SUMMARY_PATH || 'load-teszt-osszegzes'}.json`]: JSON.stringify(data, null, 2),
  };
}
