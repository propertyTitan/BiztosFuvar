// /health/ready (2026-09-11, Codex-audit P1-15): a kiszolgálhatóság mérése.
import { describe, it, expect, afterEach, vi } from 'vitest';
import request from 'supertest';

const { app } = require('./helpers');
const dbModul = require('../src/db');

afterEach(() => { vi.restoreAllMocks(); });

describe('GET /health/ready', () => {
  it('élő DB mellett 200 + db:true', async () => {
    const res = await request(app).get('/health/ready');
    expect(res.status).toBe(200);
    expect(res.body.db).toBe(true);
  });
  it('DB-kiesésnél 503 + db:false (a /health közben 200 marad)', async () => {
    vi.spyOn(dbModul, 'query').mockRejectedValue(new Error('szimulált DB-kiesés'));
    const ready = await request(app).get('/health/ready');
    expect(ready.status).toBe(503);
    expect(ready.body.db).toBe(false);
    const live = await request(app).get('/health');
    expect(live.status).toBe(200);
  });
});
