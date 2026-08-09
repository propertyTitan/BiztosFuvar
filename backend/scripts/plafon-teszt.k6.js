// =====================================================================
//  k6 PLAFON-teszt — hol a Railway Hobby konténer nyers kapacitás-határa?
//
//  A rendes load-teszt a 300/perc/IP rate limitbe ütközik egy IP-ről, így
//  a valódi szerver-plafont nem éri el. A /health végpont viszont
//  SZÁNDÉKOSAN a limiter ELŐTT van (monitoring), és nem érint DB-t —
//  ezért rajta a konténer NYERS HTTP/event-loop kapacitása mérhető
//  tisztán, terhelés-védelem nélkül.
//
//  Módszer: fokozatosan emelt, FIX terhelési szintek (50 → 2000 req/s),
//  szintenként külön scenario (tag) 15 mp-ig, hogy pontosan látszódjon,
//  MELYIK szintnél kezd romlani a latencia / jönnek a hibák.
//
//  ⚠️ Ez a PROD konténert stresszeli (közös CPU/event-loop). Launch előtt,
//  ~0 valódi felhasználóval biztonságos; éles forgalomban NE futtasd.
//  Nem hoz létre adatot, nem érint DB-t.
//
//  Futtatás:  k6 run plafon-teszt.k6.js
// =====================================================================

import http from 'k6/http';
import { Counter, Trend } from 'k6/metrics';

const API = __ENV.LOAD_API || 'https://api.gofuvar.hu';
const SZINTEK = [50, 200, 500, 1000, 1500, 2000]; // cél req/s szintenként

// Szintenkénti metrikák (a tag alapján bontható a summary)
const c2xx = new Counter('p_2xx');
const cHiba = new Counter('p_hiba'); // 5xx + hálózati hiba + timeout
const cEgyeb = new Counter('p_egyeb'); // 429/503 stb. (edge-védelem)

function makeScenarios() {
  const s = {};
  SZINTEK.forEach((rps, i) => {
    s[`sz_${rps}`] = {
      executor: 'constant-arrival-rate',
      rate: rps, timeUnit: '1s', duration: '15s',
      preAllocatedVUs: Math.min(rps, 400), maxVUs: Math.min(rps * 2, 1200),
      startTime: `${i * 20}s`, // 15s futás + 5s szünet a konténer-levegőnek
      exec: 'hit', tags: { szint: `${rps}rps` },
    };
  });
  return s;
}

// A tag-alapú submetrikák (pl. http_req_duration{szint:500rps}) CSAK akkor
// kerülnek a summary-be, ha thresholdban deklaráltuk őket — enélkül a
// szintenkénti bontás 0-ként jelenne meg. A feltételek szándékosan mindig
// igazak (>=0), csak "materializálják" a submetrikát; ez FELDERÍTÉS, nem
// pass/fail.
function makeThresholds() {
  const t = {};
  SZINTEK.forEach((rps) => {
    t[`http_req_duration{szint:${rps}rps}`] = ['p(95)>=0'];
    t[`http_reqs{szint:${rps}rps}`] = ['count>=0'];
    t[`p_hiba{szint:${rps}rps}`] = ['count>=0'];
    t[`p_2xx{szint:${rps}rps}`] = ['count>=0'];
  });
  return t;
}

export const options = {
  scenarios: makeScenarios(),
  summaryTrendStats: ['avg', 'med', 'p(95)', 'p(99)', 'max'],
  thresholds: makeThresholds(),
};

export function hit() {
  const res = http.get(`${API}/health`, { tags: { nev: 'health' }, timeout: '10s' });
  const s = res.status;
  if (s >= 200 && s < 300) c2xx.add(1);
  else if (s === 0 || s >= 500) cHiba.add(1); // 0 = hálózati hiba/timeout
  else cEgyeb.add(1); // 429/503 = terhelés-védelem (edge)
}

export function handleSummary(data) {
  const m = data.metrics;
  const round = (n) => Math.round((n || 0) * 10) / 10;
  const get = (name, stat) => (m[name] && m[name].values[stat] != null ? m[name].values[stat] : 0);

  const fejlec = ['', '========== PLAFON-teszt — /health, Railway Hobby konténer ==========', ''];
  fejlec.push('Cél req/s │ elért r/s │ p95 (ms) │ p99 (ms) │ max (ms) │ hiba │ egyéb');
  fejlec.push('──────────┼───────────┼──────────┼──────────┼──────────┼──────┼──────');

  const sorok = SZINTEK.map((rps) => {
    const tag = `${rps}rps`;
    const p95 = round(get(`http_req_duration{szint:${tag}}`, 'p(95)'));
    const p99 = round(get(`http_req_duration{szint:${tag}}`, 'p(99)'));
    const max = round(get(`http_req_duration{szint:${tag}}`, 'max'));
    const siker = get(`p_2xx{szint:${tag}}`, 'count');
    const elert = round(siker / 15); // SIKERES (2xx) ráta a 15s-es szakaszban
    const hiba = get(`p_hiba{szint:${tag}}`, 'count');
    const egyeb = get(`p_egyeb{szint:${tag}}`, 'count');
    return `${String(rps).padStart(9)} │ ${String(elert).padStart(9)} │ ${String(p95).padStart(8)} │ ${String(p99).padStart(8)} │ ${String(max).padStart(8)} │ ${String(hiba).padStart(4)} │ ${String(egyeb).padStart(5)}`;
  });

  const osszHiba = get('p_hiba', 'count');
  const osszEgyeb = get('p_egyeb', 'count');
  const ossz2xx = get('p_2xx', 'count');

  const lab = [
    '',
    `Összes kérés: ${ossz2xx + osszHiba + osszEgyeb}  (2xx: ${ossz2xx}, hiba/timeout: ${osszHiba}, terhelés-védelem: ${osszEgyeb})`,
    '',
    'OLVASAT:',
    '  - Ahol a p95/p99 megugrik VAGY a "hiba"/"egyéb" oszlop >0 → ott a konténer plafonja.',
    '  - "elért r/s" << "cél r/s" → a konténer NEM tudta kiszolgálni a célt (telített).',
    '  - "egyéb" (429/503) → a Railway edge terhelés-védelme lépett közbe.',
    '  - Ez a NYERS HTTP-plafon; a DB-t érintő végpontok ennél KEVESEBBET bírnak.',
    '=====================================================================',
    '',
  ];

  return { stdout: [...fejlec, ...sorok, ...lab].join('\n') };
}
