// =====================================================================
//  SOCKET-SZOBA JOGOSULTSÁG — VALÓDI KAPCSOLATTAL (2026-08-11)
//
//  ⚠️ MIÉRT KELLETT EZ: a 9. mérés ellenpéldája szerint a socket-réteg
//  jogosultság-ellenőrzése KIVEHETŐ volt úgy, hogy az egész suite zöld marad.
//  LEMÉRTEM, IGAZ VOLT: két sort átírva
//
//    realtime.js  'SELECT 1 FROM jobs WHERE id = $1 AND (shipper_id = $2 OR
//                  carrier_id = $2)'  →  'SELECT 1 FROM jobs WHERE id = $1'
//    realtime.js  if (me() && socket.data.emailVerified)  →  if (me() || …)
//
//  …mind a 774 teszt átment. Vagyis BÁRMELY hitelesített socket beléphetett
//  BÁRMELY fuvar szobájába (élő GPS, felvételi/kézbesítési fotók URL-lel,
//  nyers ajánlat-sorok), és minden meg nem erősített e-mailű fiók megkapta a
//  `feed`-en az új fuvarok HÁZSZÁMIG PONTOS címét — pontosan azt, amiért a
//  REST-oldal megerősített e-mailt követel.
//
//  Az ok: a meglévő socket-őr (pii-csatorna-or.test.js) FORRÁSSZÖVEGET
//  illesztett („szerepel-e a blokkban a `db.query` szó"), a `tests/` alatt
//  pedig egyetlen teszt sem nyitott valódi socketet — a `realtime-feed-szoba`
//  mockolja az `io.to`/`io.emit`-et, tehát a szobába lépést sosem futtatja.
//
//  Ez a fájl VALÓDI socket.io-klienssel csatlakozik egy VALÓDI szerverhez, és
//  a szoba-tagságot méri: kap-e a kliens olyan eseményt, amit nem szabadna.
//  Egy komment vagy egy átnevezés ezt nem elégíti ki.
// =====================================================================
import {
  describe, it, expect, beforeAll, afterAll,
} from 'vitest';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);
const http = require('http');
const { io: kliens } = require('socket.io-client');

const { db, createUser, createJob } = require('./helpers');
const { app: expressApp } = require('../src/index');
const realtime = require('../src/realtime');

let szerver;
let cim;

beforeAll(async () => {
  // Külön szerver, hogy a realtime init ne zavarja a többi teszt HTTP-jét.
  szerver = http.createServer(expressApp);
  await new Promise((r) => { szerver.listen(0, r); });
  szerver.unref();
  realtime.init(szerver);
  cim = `http://127.0.0.1:${szerver.address().port}`;
});

afterAll(async () => {
  await new Promise((r) => { szerver.close(r); });
});

/** Csatlakozott kliens adott tokennel. */
function csatlakoz(token) {
  const s = kliens(cim, {
    auth: token ? { token } : {}, transports: ['websocket'], forceNew: true, reconnection: false,
  });
  return new Promise((resolve, reject) => {
    s.on('connect', () => resolve(s));
    s.on('connect_error', reject);
    setTimeout(() => reject(new Error('socket connect timeout')), 4000);
  });
}

/** Megvárja, hogy az esemény MEGÉRKEZIK-e a megadott időn belül. */
function varEsemenyt(socket, nev, ms = 600) {
  return new Promise((resolve) => {
    const t = setTimeout(() => resolve(null), ms);
    socket.on(nev, (adat) => { clearTimeout(t); resolve(adat ?? {}); });
  });
}

describe('Socket-szobák: valódi kapcsolat, valódi jogosultság', () => {
  it('IDEGEN nem léphet be MÁS fuvarjának szobájába', async () => {
    const felado = await createUser({ role: 'shipper' });
    const szallito = await createUser({ role: 'carrier' });
    const idegen = await createUser({ role: 'carrier' });
    const job = await createJob({
      shipperId: felado.id, carrierId: szallito.id, status: 'in_progress', paid: true,
    });

    const s = await csatlakoz(idegen.token);
    try {
      s.emit('job:join', job.id);
      // Adjunk időt a szerveroldali DB-ellenőrzésnek, mielőtt sugárzunk.
      await new Promise((r) => { setTimeout(r, 250); });

      const figyelo = varEsemenyt(s, 'tracking:ping');
      realtime.emitToJob(job.id, 'tracking:ping', { lat: 47.4979, lng: 19.0402 });
      const kapott = await figyelo;

      expect(
        kapott,
        'AZ IDEGEN BELÉPETT MÁS FUVARJÁNAK SZOBÁJÁBA.\n\n'
        + 'Onnan élőben kapja a szállító GPS-pozícióját, a felvételi és\n'
        + 'kézbesítési fotókat (URL-lel), és a nyers ajánlat-sorokat.\n'
        + 'A job:join DB-ellenőrzésének a shipper_id/carrier_id feltételt IS\n'
        + 'tartalmaznia kell — nem elég, hogy lefut egy lekérdezés.',
      ).toBeNull();
    } finally { s.close(); }
  });

  it('a RÉSZTVEVŐ viszont belép (a védelem nem túl széles)', async () => {
    const felado = await createUser({ role: 'shipper' });
    const szallito = await createUser({ role: 'carrier' });
    const job = await createJob({
      shipperId: felado.id, carrierId: szallito.id, status: 'in_progress', paid: true,
    });

    const s = await csatlakoz(felado.token);
    try {
      s.emit('job:join', job.id);
      await new Promise((r) => { setTimeout(r, 250); });

      const figyelo = varEsemenyt(s, 'tracking:ping');
      realtime.emitToJob(job.id, 'tracking:ping', { lat: 46.25, lng: 20.15 });
      const kapott = await figyelo;

      expect(
        kapott,
        'A FELADÓ nem kapta meg a saját fuvarja élő pozícióját — a védelem túl széles.',
      ).not.toBeNull();
    } finally { s.close(); }
  });

  it('MEG NEM ERŐSÍTETT e-mailű fiók nem léphet be a feed szobába', async () => {
    const user = await createUser({ role: 'carrier' });
    await db.query('UPDATE users SET email_verified = FALSE WHERE id = $1', [user.id]);
    // A socket a DB-ből olvassa az email_verified-et a handshake-kor, ezért
    // a frissítés UTÁN csatlakozunk.
    const s = await csatlakoz(user.token);
    try {
      s.emit('feed:join');
      await new Promise((r) => { setTimeout(r, 250); });

      const figyelo = varEsemenyt(s, 'jobs:new');
      realtime.emitToFeed('jobs:new', {
        id: 'teszt', pickup_address: 'Budapest, Váci út 12.', pickup_lat: 47.49, pickup_lng: 19.04,
      });
      const kapott = await figyelo;

      expect(
        kapott,
        'MEG NEM ERŐSÍTETT FIÓK KAPTA A FEED-ET.\n\n'
        + 'A jobs:new payloadja nyitott fuvarnál HÁZSZÁMIG PONTOS címet és\n'
        + 'koordinátát visz — pontosan azt, amiért a GET /jobs megerősített\n'
        + 'e-mailt követel. Egy eldobható címmel a teljes piactér learatható\n'
        + 'lenne, lekérdezés nélkül, élőben.',
      ).toBeNull();
    } finally { s.close(); }
  });

  it('MEGERŐSÍTETT e-mailű fiók viszont megkapja a feedet', async () => {
    const user = await createUser({ role: 'carrier' });
    await db.query('UPDATE users SET email_verified = TRUE WHERE id = $1', [user.id]);
    const s = await csatlakoz(user.token);
    try {
      s.emit('feed:join');
      await new Promise((r) => { setTimeout(r, 250); });

      const figyelo = varEsemenyt(s, 'jobs:new');
      realtime.emitToFeed('jobs:new', { id: 'teszt2' });
      const kapott = await figyelo;

      expect(kapott, 'a megerősített fiók sem kapta meg a feedet — a kapu túl szigorú').not.toBeNull();
    } finally { s.close(); }
  });

  it('HITELESÍTÉS NÉLKÜLI kapcsolat egyik szobába sem jut be', async () => {
    const felado = await createUser({ role: 'shipper' });
    const job = await createJob({ shipperId: felado.id, status: 'bidding' });

    const s = await csatlakoz(null);
    try {
      s.emit('job:join', job.id);
      s.emit('feed:join');
      await new Promise((r) => { setTimeout(r, 250); });

      const jobFigyelo = varEsemenyt(s, 'tracking:ping', 400);
      const feedFigyelo = varEsemenyt(s, 'jobs:new', 400);
      realtime.emitToJob(job.id, 'tracking:ping', { lat: 1, lng: 1 });
      realtime.emitToFeed('jobs:new', { id: 'x' });

      expect(await jobFigyelo, 'token nélküli socket belépett egy fuvar-szobába').toBeNull();
      expect(await feedFigyelo, 'token nélküli socket belépett a feed szobába').toBeNull();
    } finally { s.close(); }
  });
});
