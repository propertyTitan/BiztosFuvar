import { it, expect, vi, afterEach } from 'vitest';
import { api } from './api';
afterEach(() => vi.restoreAllMocks());

it('az ármegerősítés eljut a szerverre, és az árváltozás új döntést igénylő hibaként tér vissza', async () => {
  const fetch = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(JSON.stringify({
    error: 'A fuvar ára időközben megváltozott.', code: 'PRICE_CHANGED',
  }), { status: 409 }));
  await expect(api.acceptInstantJob('instant', 20000)).rejects.toMatchObject({
    code: 'PRICE_CHANGED', status: 409,
  });
  expect(fetch).toHaveBeenCalledTimes(1);
  expect(JSON.parse(fetch.mock.calls[0][1]?.body as string)).toEqual({ expected_price_huf: 20000 });
});
