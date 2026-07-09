// Fizetési szolgáltató-absztrakció: a PAYMENT_PROVIDER env váltja a
// díj-fizetés providerét (barion | qvik). A hívó kód (jobs/bids) ezen megy.
import { describe, it, expect, afterEach } from 'vitest';

const paymentProvider = require('../src/services/paymentProvider');

const orig = process.env.PAYMENT_PROVIDER;
afterEach(() => {
  if (orig === undefined) delete process.env.PAYMENT_PROVIDER;
  else process.env.PAYMENT_PROVIDER = orig;
});

describe('paymentProvider absztrakció', () => {
  it('default = barion, stub gateway-t ad (nincs POS-kulcs)', async () => {
    delete process.env.PAYMENT_PROVIDER;
    expect(paymentProvider.name()).toBe('barion');
    expect(paymentProvider.isStub()).toBe(true);
    const r = await paymentProvider.startFeePayment({ jobId: 'x', feeHuf: 500, shipperEmail: 'a@b.hu' });
    expect(r.stub).toBe(true);
    expect(String(r.gatewayUrl)).toContain('stub:');
  });

  it('PAYMENT_PROVIDER=qvik → QVIK-re vált, QVIK-stub gateway-t ad', async () => {
    process.env.PAYMENT_PROVIDER = 'qvik';
    expect(paymentProvider.name()).toBe('qvik');
    expect(paymentProvider.isStub()).toBe(true); // nincs QVIK_API_KEY
    const r = await paymentProvider.startFeePayment({ jobId: 'y', feeHuf: 500, shipperEmail: 'a@b.hu' });
    expect(r.stub).toBe(true);
    expect(String(r.gatewayUrl)).toContain('stub:qvik');
  });
});
