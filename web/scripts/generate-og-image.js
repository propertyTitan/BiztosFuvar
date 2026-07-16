// OG-kép generátor — web/public/og-image.png (1200×630)
//
// A kép a Facebook/Messenger-megosztás arca (a fő marketing-csatorna!).
// Futtatás:  cd web && node scripts/generate-og-image.js
// (Google Fonts-ot tölt → net kell; a Playwright az e2e-hez már telepítve.)
//
// 2026-07-12: teljes újrarajzolás — (1) a régi képen még "Biztonságos
// letéti fizetés" szerepelt (escrow-kor előtti szöveg, a kápé-modellben
// HIBÁS állítás); (2) bekerült a telefon-mockup (a landing ProductPreview
// statikus mása) — a megosztott link így a TERMÉKET mutatja, nem csak
// szlogent; (3) a címsor Bricolage Grotesque-kel megy, mint az oldalon.
const path = require('path');
const fs = require('fs');
const { chromium } = require('@playwright/test');

const ROOT = path.resolve(__dirname, '..');
const OUT = path.join(ROOT, 'public', 'og-image.png');
// A setContent-oldal (about:blank) nem tölthet file:// képet → inline SVG
const LOGO_SVG = fs
  .readFileSync(path.join(ROOT, 'public', 'logo-white.svg'), 'utf8')
  .replace(/<\?xml[^>]*\?>/, '')
  .replace(/<!--[\s\S]*?-->/g, '');

const html = `<!doctype html>
<html><head><meta charset="utf-8">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link href="https://fonts.googleapis.com/css2?family=Bricolage+Grotesque:wght@700;800&family=Inter:wght@500;600;700;800&display=swap" rel="stylesheet">
<style>
  * { margin:0; padding:0; box-sizing:border-box; }
  body {
    width:1200px; height:630px; overflow:hidden; position:relative;
    font-family:'Inter',sans-serif;
    background:linear-gradient(120deg,#1e40af 0%,#2563eb 55%,#3b82f6 100%);
    color:#fff;
  }
  .display { font-family:'Bricolage Grotesque','Inter',sans-serif; }

  /* A→B útvonal-ív a háttérben (a márka aláírása) */
  .route { position:absolute; top:64px; right:60px; opacity:.85; }

  .left { position:absolute; left:72px; top:96px; width:640px; }
  .badge {
    display:inline-block; padding:10px 22px; border-radius:999px;
    background:rgba(255,255,255,.14); border:1.5px solid rgba(255,255,255,.35);
    font-size:22px; font-weight:700; letter-spacing:.3px; margin-bottom:36px;
  }
  h1 { font-size:76px; font-weight:800; line-height:1.06; letter-spacing:-1.5px; }
  h1 .lite { color:#bfdbfe; }
  .sub { margin-top:30px; font-size:27px; font-weight:600; color:#dbeafe; line-height:1.5; }
  .footer { position:absolute; left:72px; bottom:48px; display:flex; align-items:center; gap:22px; }
  .footer svg { height:58px; width:auto; display:block; }
  .footer .sep { width:2px; height:36px; background:rgba(255,255,255,.35); border-radius:2px; }
  .footer .url { font-size:27px; font-weight:800; color:#fff; letter-spacing:.3px; }

  /* ── Telefon-mockup (a landing ProductPreview statikus mása) ── */
  .phone {
    position:absolute; right:88px; top:150px; width:300px;
    border-radius:44px; padding:10px; background:#0b1120;
    box-shadow:0 0 0 1px rgba(255,255,255,.14), 0 40px 80px rgba(2,6,23,.45);
    transform:rotate(-5deg);
  }
  .screen { border-radius:35px; overflow:hidden; background:#f8fafc; position:relative; }
  .island { position:absolute; top:8px; left:50%; transform:translateX(-50%);
    width:76px; height:19px; border-radius:999px; background:#0b1120; z-index:2; }
  .appbar { background:linear-gradient(135deg,#1e40af,#2563eb);
    padding:34px 16px 12px; display:flex; justify-content:space-between; align-items:center; }
  .appbar .brand { font-family:'Bricolage Grotesque',sans-serif; font-size:15px; font-weight:800; color:#fff; }
  .bell { position:relative; width:16px; height:16px; }
  .bell svg { display:block; }
  .bell .dot { position:absolute; top:-5px; right:-7px; background:#f87171; color:#fff;
    font-size:8px; font-weight:800; border-radius:999px; padding:1px 4px; line-height:1.4; }
  .content { padding:12px; display:flex; flex-direction:column; gap:10px; }
  .jobcard { background:#fff; border:1px solid #e2e8f0; border-radius:12px; padding:12px; }
  .jobtop { display:flex; justify-content:space-between; align-items:center; gap:8px; }
  .jobtitle { font-size:13px; font-weight:800; color:#0f172a; }
  .pill { background:#dbeafe; color:#1e40af; font-size:9px; font-weight:700;
    border-radius:999px; padding:3px 8px; white-space:nowrap; }
  .routeline { display:flex; align-items:center; gap:6px; margin:12px 0 4px; }
  .dot-a { width:7px; height:7px; border-radius:50%; background:#1e40af; }
  .dot-b { width:7px; height:7px; border-radius:50%; background:#16a34a; }
  .dash { flex:1; height:2px; opacity:.7;
    background-image:radial-gradient(circle,#60a5fa 1.2px,transparent 1.4px);
    background-size:8px 2px; background-repeat:repeat-x; }
  .cities { display:flex; justify-content:space-between; font-size:10.5px; font-weight:700; color:#0f172a; }
  .meta { font-size:10px; color:#64748b; margin-top:6px; }
  .label { font-size:9.5px; font-weight:800; letter-spacing:1px; text-transform:uppercase; color:#64748b; margin:2px 2px 0; }
  .offer { display:flex; align-items:center; gap:8px; background:#fff;
    border:1px solid #e2e8f0; border-radius:10px; padding:8px 10px; position:relative; }
  .offer.new { border-color:#60a5fa; box-shadow:0 4px 14px rgba(37,99,235,.14); }
  .avatar { width:26px; height:26px; border-radius:50%; background:rgba(37,99,235,.14);
    color:#1e40af; display:flex; align-items:center; justify-content:center;
    font-size:9.5px; font-weight:800; }
  .oname { font-size:11.5px; font-weight:700; color:#0f172a; line-height:1.3; }
  .osub { font-size:9.5px; color:#64748b; line-height:1.3; }
  .osub .star { color:#f59e0b; }
  .ocol { flex:1; }
  .oprice { font-size:12px; font-weight:800; color:#1e40af; white-space:nowrap; }
  .newbadge { position:absolute; top:-7px; right:8px; background:#1e40af; color:#fff;
    font-size:8.5px; font-weight:800; letter-spacing:.4px; border-radius:999px;
    padding:2px 7px; text-transform:uppercase; }
  .spacer { height:8px; }
</style></head>
<body>
  <svg class="route" width="420" height="120" viewBox="0 0 420 120" fill="none">
    <path d="M14 96 C 130 18, 300 10, 406 60" stroke="rgba(255,255,255,.55)"
      stroke-width="4" stroke-dasharray="1 16" stroke-linecap="round"/>
    <circle cx="14" cy="96" r="8" fill="#bfdbfe"/>
    <circle cx="406" cy="60" r="8" fill="#34d399"/>
  </svg>

  <div class="left">
    <div class="badge">Magyarország közösségi fuvartőzsdéje</div>
    <h1 class="display">Csomagod van?<br><span class="lite">Szállítód is lesz.</span></h1>
    <div class="sub">A szállítók ajánlatot tesznek rá — te választasz.<br>Fotó bizonyíték · 6 jegyű átvételi kód</div>
  </div>

  <div class="footer">${LOGO_SVG}<span class="sep"></span><span class="url">gofuvar.hu</span></div>

  <div class="phone"><div class="screen">
    <div class="island"></div>
    <div class="appbar">
      <span class="brand">GoFuvar</span>
      <span class="bell">
        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9"/><path d="M10.3 21a1.94 1.94 0 0 0 3.4 0"/></svg>
        <span class="dot">3</span>
      </span>
    </div>
    <div class="content">
      <div class="jobcard">
        <div class="jobtop"><span class="jobtitle">IKEA PAX szekrény</span><span class="pill">Ajánlatokat vár</span></div>
        <div class="routeline"><span class="dot-a"></span><span class="dash"></span><span class="dot-b"></span></div>
        <div class="cities"><span>Budapest</span><span>Szeged</span></div>
        <div class="meta">45 kg · holnap · 171 km</div>
      </div>
      <div class="label">Ajánlatok · 3</div>
      <div class="offer"><span class="avatar">KP</span>
        <span class="ocol"><span class="oname">Kovács P.</span><br><span class="osub"><span class="star">★</span> 4,9 · 132 fuvar</span></span>
        <span class="oprice">9 500 Ft</span></div>
      <div class="offer"><span class="avatar">SA</span>
        <span class="ocol"><span class="oname">Szabó A.</span><br><span class="osub"><span class="star">★</span> 5,0 · 78 fuvar</span></span>
        <span class="oprice">10 200 Ft</span></div>
      <div class="offer new"><span class="newbadge">Új</span><span class="avatar">TG</span>
        <span class="ocol"><span class="oname">Tóth G.</span><br><span class="osub"><span class="star">★</span> 4,8 · 214 fuvar</span></span>
        <span class="oprice">8 900 Ft</span></div>
      <div class="spacer"></div>
    </div>
  </div></div>
</body></html>`;

(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1200, height: 630 } });
  await page.setContent(html, { waitUntil: 'networkidle' });
  await page.evaluate(() => document.fonts.ready);
  await page.waitForTimeout(300);
  await page.screenshot({ path: OUT });
  await browser.close();
  console.log('OG-kép kész:', OUT);
})();
