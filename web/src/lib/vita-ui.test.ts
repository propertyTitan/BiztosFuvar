import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';

// KETTŐS VITA-UI ŐR (2026-09-11, teljes audit B2): a feladói fuvar-oldalon
// KÉT vita-nyitó felület és KÉT „vita folyamatban" doboz élt egymás mellett
// (a „Probléma van a fuvarral?" kártya + dialógus, ÉS a DisputeButton saját
// modalja; „Vita folyamatban" ÉS „Vitás eset folyamatban"). A feladó két
// különböző szöveget és két gombot látott ugyanarra. A szállítói oldalon a
// DisputeButton marad (ott az az egyetlen út).
describe('vita-UI', () => {
  it('a feladói fuvar-oldalon EGY vita-nyitó út és EGY állapot-doboz van', () => {
    const src = readFileSync(path.join(process.cwd(), 'app/dashboard/fuvar/[id]/page.tsx'), 'utf8');
    expect(src, 'a DisputeButton még a feladói oldalon van (dupla vita-gomb)').not.toMatch(/<DisputeButton/);
    expect(src, 'a második „Vitás eset folyamatban" doboz megmaradt').not.toContain('Vitás eset folyamatban');
    expect(src).toContain('Vita folyamatban');
    expect(src).toContain('setShowDisputeDialog(true)');
  });
  it('a szállítói fuvar-oldalon marad a vita-nyitás lehetősége', () => {
    const src = readFileSync(path.join(process.cwd(), 'app/sofor/fuvar/[id]/page.tsx'), 'utf8');
    expect(src).toMatch(/<DisputeButton/);
  });
});
