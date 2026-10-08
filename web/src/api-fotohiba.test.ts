// UX Q14 (2026-10-08): a felvételi/kézbesítési fotó-feltöltés hibája a
// backend gépi mezőit is hordozza (code, remaining_attempts) — a kapuban
// álló szállítónak szóló üzenet így nem a magyar szövegből olvassa ki,
// hány próbálkozás maradt.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { api, fotoFeltoltesHiba } from './api';

function valasz(status: number, body: unknown): Response {
  return { ok: false, status, statusText: `HTTP ${status}`, json: async () => body } as unknown as Response;
}

const eredetiFetch = global.fetch;
afterEach(() => { global.fetch = eredetiFetch; });

describe('fotoFeltoltesHiba', () => {
  it('a szöveg mellé a code-ot, a státuszt és a maradék próbálkozást is ráteszi', async () => {
    const h = await fotoFeltoltesHiba(valasz(403, {
      error: 'Érvénytelen átvételi kód (még 3 próbálkozás)', code: 'INVALID_DELIVERY_CODE', remaining_attempts: 3,
    }));
    expect(h.message).toBe('Érvénytelen átvételi kód (még 3 próbálkozás)');
    expect(h.code).toBe('INVALID_DELIVERY_CODE');
    expect(h.status).toBe(403);
    expect(h.remainingAttempts).toBe(3);
  });

  it('nem-JSON vagy hiányos válaszra semleges szöveg, gépi mezők nélkül', async () => {
    const h = await fotoFeltoltesHiba({ ok: false, status: 502, json: async () => { throw new Error('nem JSON'); } } as unknown as Response);
    expect(h.message).toBe('Fotó feltöltés sikertelen');
    expect(h.code).toBeUndefined();
    expect(h.remainingAttempts).toBeUndefined();
  });
});

describe('a feltöltő hívások ezt a hibát dobják', () => {
  it.each([
    ['uploadJobPhoto', () => api.uploadJobPhoto('j1', new File(['x'], 'a.jpg'), 'dropoff', { deliveryCode: '000000' })],
    ['uploadBookingPhoto', () => api.uploadBookingPhoto('b1', new File(['x'], 'a.jpg'), 'dropoff', { deliveryCode: '000000' })],
  ])('%s', async (_nev, hivas) => {
    global.fetch = vi.fn().mockResolvedValue(valasz(429, { error: 'zárolva', code: 'CODE_LOCKED' }));
    await expect(hivas()).rejects.toMatchObject({ code: 'CODE_LOCKED', status: 429, message: 'zárolva' });
  });
});
