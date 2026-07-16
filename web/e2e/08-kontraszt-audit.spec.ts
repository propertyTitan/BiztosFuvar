// Kontraszt-őr (CI): light ÉS dark módban minden fő oldalon ellenőrzi,
// hogy nincs a WCAG AA alatt olvashatatlanná olvadó szöveg. Ha új UI
// rossz színpárt vezet be, ez a teszt elhasal a pontos listával.
// Minden látható szövegre kiszámolja a WCAG kontrasztarányt a tényleges
// (felmenőkből kompozitált) háttérrel szemben, és kilistázza ami a
// AA-küszöb (4.5 normál / 3 nagy szöveg) alatt van.
import { test, expect } from '@playwright/test';
import { createUser, createJob, loginAs, placeBid, setJobAccepted, dbQuery } from './helpers';

type Issue = { text: string; ratio: number; color: string; bg: string; path: string };

async function auditPage(page: import('@playwright/test').Page): Promise<Issue[]> {
  return page.evaluate(() => {
    function parseColor(s: string): [number, number, number, number] | null {
      const m = s.match(/rgba?\(([\d.]+),\s*([\d.]+),\s*([\d.]+)(?:,\s*([\d.]+))?\)/);
      if (!m) return null;
      return [+m[1], +m[2], +m[3], m[4] === undefined ? 1 : +m[4]];
    }
    function lum(c: number[]) {
      const f = (x: number) => { x /= 255; return x <= 0.03928 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4; };
      return 0.2126 * f(c[0]) + 0.7152 * f(c[1]) + 0.0722 * f(c[2]);
    }
    function contrast(a: number[], b: number[]) {
      const l1 = lum(a); const l2 = lum(b);
      return (Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05);
    }
    function composite(fg: [number, number, number, number], bg: [number, number, number]): [number, number, number] {
      const a = fg[3];
      return [fg[0] * a + bg[0] * (1 - a), fg[1] * a + bg[1] * (1 - a), fg[2] * a + bg[2] * (1 - a)];
    }
    function effectiveBg(el: Element): [number, number, number] | null {
      const layers: [number, number, number, number][] = [];
      let node: Element | null = el;
      while (node) {
        const cs = getComputedStyle(node);
        if (cs.backgroundImage && cs.backgroundImage !== 'none') return null; // gradiens/kép → kihagyjuk
        const c = parseColor(cs.backgroundColor);
        if (c && c[3] > 0) {
          layers.push(c);
          if (c[3] >= 1) break;
        }
        node = node.parentElement;
      }
      if (!layers.length || layers[layers.length - 1][3] < 1) {
        const bodyBg = parseColor(getComputedStyle(document.body).backgroundColor);
        layers.push(bodyBg && bodyBg[3] > 0 ? [bodyBg[0], bodyBg[1], bodyBg[2], 1] : [255, 255, 255, 1]);
      }
      let bg: [number, number, number] = [layers[layers.length - 1][0], layers[layers.length - 1][1], layers[layers.length - 1][2]];
      for (let i = layers.length - 2; i >= 0; i -= 1) bg = composite(layers[i], bg);
      return bg;
    }
    const out: { text: string; ratio: number; color: string; bg: string; path: string }[] = [];
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    const seen = new Set<Element>();
    while (walker.nextNode()) {
      const t = walker.currentNode as Text;
      const el = t.parentElement;
      if (!el || seen.has(el)) continue;
      const txt = (t.textContent || '').trim();
      if (txt.length < 2) continue;
      seen.add(el);
      if (el.closest('.gm-style,[aria-hidden="true"],script,style,noscript')) continue;
      if (el.closest('button[disabled],[disabled]')) continue; // disabled elemre nincs WCAG-követelmény
      const cs = getComputedStyle(el);
      if (cs.visibility === 'hidden' || cs.display === 'none' || +cs.opacity === 0) continue;
      const rect = el.getBoundingClientRect();
      if (rect.width < 2 || rect.height < 2) continue;
      const fg = parseColor(cs.color);
      if (!fg) continue;
      const bg = effectiveBg(el);
      if (!bg) continue;
      const fgRgb: [number, number, number] = fg[3] < 1 ? composite(fg, bg) : [fg[0], fg[1], fg[2]];
      const ratio = contrast(fgRgb, bg);
      const fontSize = parseFloat(cs.fontSize);
      const bold = parseInt(cs.fontWeight, 10) >= 600;
      const large = fontSize >= 24 || (fontSize >= 18.66 && bold);
      const min = large ? 3 : 4.5;
      if (ratio < min) {
        out.push({
          text: txt.slice(0, 50),
          ratio: Math.round(ratio * 10) / 10,
          color: cs.color,
          bg: `rgb(${bg.map(Math.round).join(',')})`,
          path: el.tagName.toLowerCase() + (el.className && typeof el.className === 'string' ? `.${el.className.split(' ')[0]}` : ''),
        });
      }
    }
    return out;
  });
}

test('kontraszt-audit: light + dark módban minden fő oldalon 0 probléma', async ({ browser }) => {
  test.setTimeout(600_000);
  const shipper = await createUser('shipper', 'Feladó Ferenc');
  const carrier = await createUser('carrier', 'Szállító Sándor');
  const admin = await createUser('admin', 'Admin Aladár');
  const biddingJob = await createJob(shipper);
  await placeBid(carrier, biddingJob.id, 12000);
  const activeJob = await createJob(shipper);
  await setJobAccepted(activeJob.id, carrier.id, { paid: true });
  await dbQuery(
    `INSERT INTO kyc_documents (user_id, doc_type, file_url, status) VALUES ($1,'id_card','/uploads/x.png','pending')`,
    [shipper.id],
  );

  const plans: { user: typeof shipper | null; routes: string[] }[] = [
    { user: null, routes: ['/bejelentkezes', '/bejelentkezes?mode=register', '/jelszo-reset'] },
    {
      user: shipper,
      routes: [
        '/', '/dashboard/uj-fuvar', `/dashboard/fuvar/${biddingJob.id}`,
        `/dashboard/fuvar/${activeJob.id}`, '/dashboard/utvonalak', '/fuvarjaim',
        '/ertesitesek', '/profil', '/hozasd-el', '/aszf', '/adatkezeles',
      ],
    },
    {
      user: carrier,
      routes: [
        '/', '/sofor/fuvarok', `/sofor/fuvar/${biddingJob.id}`, `/sofor/fuvar/${activeJob.id}`,
        '/sofor/dashboard', '/sofor/uj-utvonal', '/sofor/utvonalaim', '/sofor/visszafuvar',
        '/sofor/ertesitok', '/sofor/licitjeim',
      ],
    },
    { user: admin, routes: ['/admin'] },
  ];

  const report: Record<string, Issue[]> = {};
  for (const scheme of ['light', 'dark'] as const) {
    for (const plan of plans) {
      const ctx = await browser.newContext({ colorScheme: scheme, viewport: { width: 1280, height: 900 } });
      const page = await ctx.newPage();
      if (plan.user) await loginAs(page, plan.user);
      for (const route of plan.routes) {
        await page.goto(route, { waitUntil: 'domcontentloaded' }).catch(() => page.goto(route, { waitUntil: 'domcontentloaded' }));
        await page.waitForTimeout(1200);
        const issues = await auditPage(page);
        if (issues.length) report[`[${scheme}] ${plan.user ? plan.user.role : 'anon'} ${route}`] = issues;
      }
      await ctx.close();
    }
  }

  const total = Object.values(report).reduce((s, i) => s + i.length, 0);
  const lines: string[] = [];
  for (const [pageKey, issues] of Object.entries(report)) {
    lines.push(`--- ${pageKey} (${issues.length}) ---`);
    for (const i of issues.slice(0, 8)) {
      lines.push(`  [${i.ratio}] "${i.text}" — ${i.color} / ${i.bg} @ ${i.path}`);
    }
  }
  expect(total, `Kontraszt-problémák:\n${lines.join('\n')}`).toBe(0);
});
