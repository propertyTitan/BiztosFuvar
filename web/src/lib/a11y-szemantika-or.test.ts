// @vitest-environment node
// =====================================================================
//  AKADÁLYMENTES SZEMANTIKA ŐRE — UX A29 (2026-10-08)
//
//  Az axe (19-es E2E) a „critical/serious" szintet méri; ezek a hibák
//  alatta maradtak, mégis a felolvasós használatot törték:
//   - nem volt „Ugrás a tartalomra" link (WCAG 2.4.1);
//   - a visszaszállítási rádiók (jogi-üzleti vállalás!) kérdése nem
//     hangzott el — egyetlen fieldset sem volt a projektben;
//   - a szegmens-kapcsolók (Belépés/Regisztráció, Magánszemély/Cég,
//     Lista/Térkép, Feladó/Szállító) állapota nem volt hallható;
//   - a csengő neve „4, hivatkozás" volt.
//  A komponens-viselkedést a SegmentedControl.test.tsx méri; ez az őr azt,
//  hogy a felületek tényleg azt használják.
// =====================================================================
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

const WEB = path.resolve(__dirname, '..', '..');
const olvas = (rel: string) => fs.readFileSync(path.join(WEB, rel), 'utf8');

describe('akadálymentes szemantika (UX A29)', () => {
  it('a layout első eleme az „Ugrás a tartalomra" link, a main a célja', () => {
    const s = olvas('app/layout.tsx');
    expect(s).toMatch(/<a href="#tartalom" className="ugro-link">Ugrás a tartalomra<\/a>/);
    expect(s).toMatch(/<main id="tartalom"/);
    expect(s.indexOf('ugro-link')).toBeLessThan(s.indexOf('<SiteHeader'));
  });

  it('a visszaszállítási nyilatkozat fieldset/legend keretben van', () => {
    const s = olvas('app/sofor/fuvar/[id]/page.tsx');
    const i = s.indexOf('name="return_policy"');
    expect(i).toBeGreaterThan(-1);
    const elotte = s.slice(0, i);
    expect(elotte.lastIndexOf('<fieldset')).toBeGreaterThan(elotte.lastIndexOf('</fieldset>'));
    expect(s.slice(elotte.lastIndexOf('<fieldset'), i)).toMatch(/<legend[\s\S]*Sikertelen kézbesítés esetén[\s\S]*<\/legend>/);
  });

  it('a szegmens-kapcsolók a közös SegmentedControl-t használják, nem aria-pressed gombot', () => {
    for (const rel of ['app/bejelentkezes/page.tsx', 'app/sofor/fuvarok/page.tsx', 'src/components/HomeHub.tsx']) {
      const s = olvas(rel);
      expect(s, `${rel}: nincs SegmentedControl`).toMatch(/<SegmentedControl/);
    }
    const belepes = olvas('app/bejelentkezes/page.tsx');
    expect(belepes).toMatch(/role="tablist"/);
    expect(belepes).toMatch(/role="tab"/);
    expect(belepes).not.toMatch(/aria-pressed=\{/);
  });

  it('a csengő neve a teljes jelentés, a szám-jelvény aria-hidden', () => {
    const s = olvas('src/components/SiteHeader.tsx');
    expect(s).toMatch(/aria-label=\{unread > 0 \? `Értesítések, \$\{unread\} olvasatlan` : 'Értesítések'\}/);
  });
});
