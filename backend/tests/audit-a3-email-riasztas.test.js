// =====================================================================
//  TELJES AUDIT — A3 csomag (2026-09-11): e-mail / értesítés-kiesés
//   - átmeneti Resend-hiba (5xx / 429 / hálózat) → újrapróba, siker
//   - végleges kiesés → Sentry-riasztás (hibamódonként fojtva, számlálóval)
//   - 4xx → nincs újrapróba, riasztás igen
//   - értesítés-beszúrás hibája → Sentry captureException
// =====================================================================
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const email = require('../src/services/email');
const Sentry = require('@sentry/node');
const { createNotification } = require('../src/services/notifications');
const { db } = require('./helpers');

const LEVEL = { to: 'teszt-cimzett@example.com', subject: 'Teszt tárgy', html: '<p>szia</p>' };
const valasz = (status, body = '{}') => ({
  ok: status >= 200 && status < 300, status, text: async () => body, json: async () => JSON.parse(body),
});

let eredetiFetch;
let eredetiKulcs;
beforeEach(() => {
  eredetiFetch = global.fetch;
  eredetiKulcs = process.env.RESEND_API_KEY;
  process.env.RESEND_API_KEY = 're_teszt_hamis_kulcs'; // hogy ne STUB legyen — a fetch mockolt, hálózat NINCS
  process.env.EMAIL_RETRY_BACKOFF_MS = '1,1';
  email.__resetEmailAlertsForTests?.();
});
afterEach(() => {
  global.fetch = eredetiFetch;
  if (eredetiKulcs === undefined) delete process.env.RESEND_API_KEY; else process.env.RESEND_API_KEY = eredetiKulcs;
  delete process.env.EMAIL_RETRY_BACKOFF_MS;
  vi.restoreAllMocks();
});

describe('sendEmail — újrapróba + riasztás', () => {
  it('két 500 után a harmadik siker: a levél elmegy, nincs riasztás', async () => {
    const hivasok = [];
    global.fetch = vi.fn(async (url, opts) => {
      hivasok.push(JSON.parse(opts.body).to[0]);
      return hivasok.length < 3 ? valasz(500, 'upstream') : valasz(200, '{"id":"re_ok"}');
    });
    const capture = vi.spyOn(Sentry, 'captureMessage').mockImplementation(() => 'x');
    const r = await email.sendEmail(LEVEL);
    expect(global.fetch, 'átmeneti hibánál nem próbáltuk újra').toHaveBeenCalledTimes(3);
    expect(r?.id, 'a végül sikeres küldést null-ként adtuk vissza').toBe('re_ok');
    expect(capture, 'sikeres újrapróba után is riasztottunk').not.toHaveBeenCalled();
  });

  it('tartós 5xx: 3 kísérlet, null, EGY Sentry-riasztás; a fojtás alatt a többi kiesés csak számlálódik', async () => {
    global.fetch = vi.fn(async () => valasz(503, 'down'));
    const capture = vi.spyOn(Sentry, 'captureMessage').mockImplementation(() => 'x');
    expect(await email.sendEmail(LEVEL)).toBeNull();
    expect(global.fetch).toHaveBeenCalledTimes(3);
    expect(capture, 'a végleges e-mail-kiesésről NEM ment Sentry-riasztás — csak a Railway-logban látszott').toHaveBeenCalledTimes(1);
    const [uzenet, ctx] = capture.mock.calls[0];
    expect(uzenet).toMatch(/1 e-mail elveszett \(http-5xx\)/);
    expect(ctx.extra.utolso_cimzett, 'a riasztásban maszkolatlan címzett').not.toMatch(/teszt-cimzett@example\.com/);
    // második kiesés a 10 perces ablakon belül → nincs új riasztás
    expect(await email.sendEmail(LEVEL)).toBeNull();
    expect(capture).toHaveBeenCalledTimes(1);
  });

  it('hálózati hiba is átmeneti: újrapróba, majd riasztás „network" móddal', async () => {
    global.fetch = vi.fn(async () => { throw new Error('ECONNRESET'); });
    const capture = vi.spyOn(Sentry, 'captureMessage').mockImplementation(() => 'x');
    expect(await email.sendEmail(LEVEL)).toBeNull();
    expect(global.fetch).toHaveBeenCalledTimes(3);
    expect(capture).toHaveBeenCalledTimes(1);
    expect(capture.mock.calls[0][0]).toMatch(/\(network\)/);
  });

  it('végleges 4xx (pl. érvénytelen kulcs): NINCS újrapróba, de van riasztás', async () => {
    global.fetch = vi.fn(async () => valasz(401, '{"message":"invalid api key"}'));
    const capture = vi.spyOn(Sentry, 'captureMessage').mockImplementation(() => 'x');
    expect(await email.sendEmail(LEVEL)).toBeNull();
    expect(global.fetch, '4xx-re is újrapróbáltunk (értelmetlen, és a limitet fogyasztja)').toHaveBeenCalledTimes(1);
    expect(capture).toHaveBeenCalledTimes(1);
    expect(capture.mock.calls[0][0]).toMatch(/\(http-4xx\)/);
  });

  it('a riasztás fojtása hibamódonként külön számol', async () => {
    const capture = vi.spyOn(Sentry, 'captureMessage').mockImplementation(() => 'x');
    global.fetch = vi.fn(async () => valasz(422, 'bad'));
    await email.sendEmail(LEVEL);
    global.fetch = vi.fn(async () => valasz(500, 'down'));
    await email.sendEmail(LEVEL);
    expect(capture).toHaveBeenCalledTimes(2);
  });
});

describe('createNotification — a beszúrás hibája riaszt', () => {
  it('DB-hiba → null (a hívó nem törik meg) + Sentry captureException', async () => {
    const capture = vi.spyOn(Sentry, 'captureException').mockImplementation(() => 'x');
    const eredeti = db.query;
    db.query = async (t, p) => {
      if (/INSERT INTO notifications/i.test(String(t))) throw new Error('szimulált DB-hiba');
      return eredeti(t, p);
    };
    let r;
    try {
      r = await createNotification({ user_id: '00000000-0000-0000-0000-000000000000', type: 'teszt', title: 'Teszt' });
    } finally { db.query = eredeti; }
    expect(r).toBeNull();
    expect(capture, 'az értesítés-beszúrás hibája nem riasztott — a felhasználó semmit nem lát az eseményről').toHaveBeenCalledTimes(1);
  });
});
