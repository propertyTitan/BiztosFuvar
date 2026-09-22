import { afterAll, expect, it } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

// A valódi CI-scriptet futtatjuk; csak a külső registry válaszát helyettesítjük.
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'gofuvar-audit-gate-'));
fs.writeFileSync(path.join(dir, 'npm'), `#!${process.execPath}\nprocess.stdout.write(process.env.AUDIT_FIXTURE); process.exit(Number(process.env.AUDIT_EXIT));\n`, { mode: 0o755 });
afterAll(() => fs.rmSync(dir, { recursive: true, force: true }));
const report = severity => ({
  auditReportVersion: 2,
  vulnerabilities: severity ? { dependency: { severity } } : {},
  metadata: { vulnerabilities: Object.fromEntries(
    ['info', 'low', 'moderate', 'high', 'critical', 'total'].map(k => [k, severity && (k === severity || k === 'total') ? 1 : 0]),
  ) },
});

it.each([
  ['tiszta', report(), 0, 0],
  ['moderate', report('moderate'), 1, 0],
  ['high', report('high'), 1, 1],
  ['critical', report('critical'), 1, 1],
  ['registry kiesés', { error: { code: 'ENOTFOUND' } }, 1, 1],
  ['üres objektum', {}, 0, 1],
  ['null', null, 0, 1],
  ['nem JSON', '<html>proxy unavailable</html>', 1, 1],
  ['hibás séma', { ...report(), vulnerabilities: [] }, 0, 1],
  ['hiányzó high részlet', { ...report('high'), vulnerabilities: {} }, 0, 1],
  ['futtatási hiba érvényes részjelentéssel', report(), 2, 1],
])('%s: a CI-kapu helyesen dönt', (_name, fixture, exitCode, expected) => {
  const result = spawnSync(process.execPath, [path.resolve(__dirname, '../../scripts/fuggoseg-audit.js'), dir], {
    encoding: 'utf8', timeout: 10_000,
    env: { ...process.env, PATH: `${dir}${path.delimiter}${process.env.PATH}`, AUDIT_FIXTURE: typeof fixture === 'string' ? fixture : JSON.stringify(fixture), AUDIT_EXIT: String(exitCode) },
  });
  expect(result.error).toBeUndefined();
  expect(result.status, result.stdout + result.stderr).toBe(expected);
  if (expected) expect(result.stdout).not.toContain('✔');
});
