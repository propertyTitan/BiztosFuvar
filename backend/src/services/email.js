// Tranzakciós email küldés Resend API-n keresztül.
//
// A GoFuvar az értesítési eseményeket in-app DB notifikáción + Socket.IO
// toaston + mostantól EMAIL-en is kihirdeti. Így akkor is tudomást
// szerez a felhasználó egy történésről, ha éppen nincs bent az app-ban.
//
// Ha nincs `RESEND_API_KEY` beállítva (fejlesztés), STUB mód: csak
// naplózunk, a email nem megy el. Ez a Gemini/Barion mintához igazodik,
// így a teljes workflow tesztelhető external account nélkül is.
//
// Konfig:
//   RESEND_API_KEY=re_...
//   EMAIL_FROM="GoFuvar <noreply@gofuvar.hu>"   (default a seedhez)
//   WEB_BASE_URL=https://app.gofuvar.hu          (a linkekhez)

const { maskEmail, maskInText } = require('../utils/mask');
const { kulsoHivasSignal } = require('../utils/httpIdokeret');
const { CIB_FELIRATOK, CIB_ADATSOR_SORREND } = require('../data/cibFeliratok');
const { RC_CSOPORT_UZENET, X0_UZENET } = require('../data/cibRcCsoportok');

const RESEND_API_URL = 'https://api.resend.com/emails';

function isStub() {
  return !process.env.RESEND_API_KEY;
}

function getFrom() {
  return process.env.EMAIL_FROM || 'GoFuvar <onboarding@resend.dev>';
}

function getWebBase() {
  return process.env.WEB_BASE_URL || 'http://localhost:3000';
}

// User-vezérelt értékek (név, fuvarcím, stb.) HTML-be ágyazás előtti escape-elése.
// E nélkül egy rosszhiszemű cím/név (pl. <img src=x onerror=…> vagy egy
// phishing <a href>) nyersen bekerülne a tranzakciós emailek HTML-törzsébe.
// A tárgysorra NEM kell — az plain-text a Resend felé.
function escapeHtml(value) {
  if (value == null) return '';
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

// ── E-MAIL-KIESÉS: ÚJRAPRÓBA + RIASZTÁS (2026-09-11, teljes audit A3) ───────
//
// Eddig egy sikertelen küldés EGYETLEN `console.error` volt a Railway-logban,
// amit senki nem néz — és 21 hívóhely `.catch(() => console.warn(...))`-nal
// nyelte el a maradékot. Az e-mail a platform FŐ csatornája (megerősítő
// link, díj-visszaigazolás, fizetési felhívás, vita): egy Resend-kiesés vagy
// egy lejárt kulcs napokig észrevétlen maradt volna, miközben a
// felhasználók „nem jött meg a levél"-lel küzdenek.
//
//  (1) ÁTMENETI hiba (429 / 5xx / hálózat) → rövid backoffos újrapróba
//      (alapból 1 s, 4 s — env: EMAIL_RETRY_BACKOFF_MS="1000,4000"). Az
//      újrapróba ugyanabban a hívásban fut, a hívó megvárja: a 21 hívóhely
//      többsége úgyis setImmediate-ből hív, a kérés-útra kötöttek (pl. a
//      regisztrációs megerősítő) 35 mp-es kliens-keretben futnak.
//  (2) VÉGLEGES hiba (4xx, vagy az újrapróbák is elbuktak) → Sentry-riasztás,
//      hibamódonként (státusz-osztály) 10 percenként legfeljebb egyszer, a
//      közben összegyűlt kiesések SZÁMÁVAL. E-mail-riasztás itt nem lehet
//      (pont az e-mail nem megy) — az SMS-ág e-mail-riasztása a párja.
//  PII: a riasztásban a címzett maszkolva, a tárgy maskInText-tel; body soha.
//  Őr: tests/audit-a3-email-riasztas.test.js.
// ─────────────────────────────────────────────────────────────────────────
const RIASZTAS_ABLAK_MS = 10 * 60 * 1000;
const kiesesek = new Map(); // hibamód → { db, utolsoRiasztas }

function backoffLista() {
  const raw = process.env.EMAIL_RETRY_BACKOFF_MS || '1000,4000';
  return raw.split(',').map((x) => Number(x.trim())).filter((n) => Number.isFinite(n) && n >= 0);
}

function atmenetiHiba(status) {
  return status === 429 || (status >= 500 && status <= 599) || status === 'network';
}

function riasztEmailKieses(hibamod, { to, subject, reszlet }) {
  const most = Date.now();
  const v = kiesesek.get(hibamod) || { db: 0, utolsoRiasztas: 0 };
  v.db += 1;
  kiesesek.set(hibamod, v);
  if (most - v.utolsoRiasztas < RIASZTAS_ABLAK_MS) return; // fojtva — a számláló nő
  const db = v.db;
  v.db = 0;
  v.utolsoRiasztas = most;
  try {
    const Sentry = require('@sentry/node');
    Sentry.captureMessage(`[email] ${db} e-mail elveszett (${hibamod}) az elmúlt 10 percben`, {
      level: 'error',
      tags: { csatorna: 'email', hibamod: String(hibamod) },
      extra: {
        utolso_cimzett: maskEmail(to),
        // (D1) Tárgy-OSZTÁLY, nem tárgy: idézett rész (fuvar címe) és
        // számjegyek nélkül — a Sentry-be sem kód, sem összeg, sem cím nem megy.
        targy_osztaly: maskInText(String(subject || ''))
          .replace(/["„”][^"„”]*["„”]/g, '„…”')
          .replace(/\d/g, '#')
          .slice(0, 60),
        reszlet: maskInText(String(reszlet || '').slice(0, 200)),
      },
    });
  } catch { /* a riasztás hibája sosem érintheti a küldést */ }
}

/** Tesztekhez: a fojtás-állapot nullázása. */
function __resetEmailAlertsForTests() { kiesesek.clear(); }

async function egyszerKuld({ to, subject, html, text }) {
  try {
    const res = await fetch(RESEND_API_URL, {
      method: 'POST',
      // (D4, 2026-09-13) kísérletenkénti időkeret — enélkül egy „lassan
      // haldokló" Resend az újrapróbákkal ~15 percre fogta a hívót.
      signal: kulsoHivasSignal(),
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${process.env.RESEND_API_KEY}`,
      },
      body: JSON.stringify({
        from: getFrom(),
        to: [to],
        subject,
        html,
        text: text || html.replace(/<[^>]+>/g, ''),
      }),
    });
    if (!res.ok) {
      const body = await res.text().catch(() => '');
      // ⚠️ A RESEND VISSZHANGOZZA A CÍMZETTET (2026-08-11, adatáramlási audit).
      // A 4xx-válaszok tartalmazzák a `to` mezőt, tehát maszkolatlan
      // e-mail-cím került a Railway-logba — miközben ennek a fájlnak minden
      // más log-sora maskEmail-t használ. Egyetlen kilógó sor volt.
      console.error('[email] Resend hiba:', res.status, maskInText(body.slice(0, 300)));
      return { ok: false, status: res.status, reszlet: body.slice(0, 200) };
    }
    const json = await res.json();
    return { ok: true, id: json.id || null };
  } catch (err) {
    console.error('[email] hálózati hiba:', err.message);
    return { ok: false, status: 'network', reszlet: err.message };
  }
}

/**
 * Nyers küldés Resend API-n keresztül (vagy STUB mode-ban csak log).
 * Sose dob hibát — ha el is akad, naplóz + riaszt, és null-al tér vissza,
 * hogy az eredeti tranzakció (pl. fizetés nyugtázás) ne forduljon meg
 * attól, hogy a maileküldő szolgáltató épp nincs elérhető.
 *
 * @param {object} opts
 * @param {string} opts.to – címzett email
 * @param {string} opts.subject – tárgy
 * @param {string} opts.html – HTML body
 * @param {string} [opts.text] – plain-text body (auto-generált ha nincs)
 */
async function sendEmail({ to, subject, html, text }) {
  if (!to || !subject || !html) {
    console.warn('[email] hiányos adat:', { to: maskEmail(to), subject });
    return null;
  }
  if (isStub()) {
    // A body-t NEM logoljuk: tartalmazhat átvételi kódot / tracking linket.
    console.log('[email STUB]', { to: maskEmail(to), subject });
    return { stub: true, id: `stub-${Date.now()}` };
  }
  const varakozasok = backoffLista();
  let utolso = null;
  for (let kiserlet = 0; kiserlet <= varakozasok.length; kiserlet++) {
    if (kiserlet > 0) {
      // eslint-disable-next-line no-await-in-loop
      await new Promise((r) => setTimeout(r, varakozasok[kiserlet - 1]));
      console.warn(`[email] újrapróba ${kiserlet}/${varakozasok.length}: ${maskEmail(to)}`);
    }
    // eslint-disable-next-line no-await-in-loop
    utolso = await egyszerKuld({ to, subject, html, text });
    if (utolso.ok) return { stub: false, id: utolso.id };
    if (!atmenetiHiba(utolso.status)) break; // végleges (4xx) — nincs értelme ismételni
  }
  const hibamod = utolso.status === 'network' ? 'network' : `http-${String(utolso.status)[0]}xx`;
  riasztEmailKieses(hibamod, { to, subject, reszlet: utolso.reszlet });
  return null;
}

// ---------- HTML email sablon (egyszerű wrapper) ----------


/**
 * GDPR 14. cikk szerinti tájékoztató blokk a CÍMZETTNEK.
 *
 * ⚠️ 2026-08-11: ez a szöveg korábban EGYETLEN e-mail-függvényben élt
 * (`sendRecipientTrackingEmail`), a címzettnek küldött többi levél nem kapta
 * meg. Ez ugyanaz a minta, ami ebben a projektben többször okozott „csak az
 * egyiket javítottuk" hibát — ezért közös helyre került. Aki a címzettnek ír,
 * ezt hívja.
 */
function cimzettiTajekoztatoBlokk() {
  return `        <div style="margin-top:24px;padding-top:16px;border-top:1px solid #e2e8f0;font-size:11px;line-height:1.6;color:#94a3b8">
          <strong>Honnan tudjuk az elérhetőségedet?</strong> A csomag feladója adta meg,
          hogy értesíteni tudjunk az érkezésről. Az adataidat (név, telefonszám, e-mail-cím,
          szállítási cím) kizárólag ennek a küldeménynek a kézbesítéséhez használjuk,
          és a fuvar lezárását követő 3 éven belül töröljük.
          <br><br>
          Adatkezelő: <strong>Tiszta Hód Kft.</strong> (6800 Hódmezővásárhely, Szántó Kovács
          János utca 144.) ·
          <a href="${getWebBase()}/adatkezeles#cimzett" style="color:#94a3b8">Adatkezelési tájékoztató</a>
          <br>
          Ha nem szeretnéd, hogy kezeljük az adataidat, vagy nem te vagy a címzett, írj az
          <a href="mailto:info@gofuvar.hu" style="color:#94a3b8">info@gofuvar.hu</a> címre.
        </div>`;
}

function wrapHtml({ heading, bodyHtml, ctaText, ctaHref }) {
  const cta = ctaText && ctaHref
    ? `<p style="margin:24px 0 0">
         <a href="${ctaHref}"
            style="display:inline-block;background:#1e40af;color:#fff;padding:12px 22px;border-radius:8px;text-decoration:none;font-weight:700;font-size:14px">
           ${ctaText}
         </a>
       </p>`
    : '';
  return `
<!doctype html>
<html lang="hu">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <title>GoFuvar</title>
</head>
<body style="margin:0;padding:0;background:#f1f5f9;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Arial,sans-serif;color:#0f172a">
  <table width="100%" cellpadding="0" cellspacing="0" border="0" style="background:#f1f5f9;padding:32px 16px">
    <tr>
      <td align="center">
        <table width="600" cellpadding="0" cellspacing="0" border="0" style="background:#ffffff;border-radius:16px;overflow:hidden;box-shadow:0 4px 20px rgba(0,0,0,0.06);max-width:600px">
          <tr>
            <td style="background:linear-gradient(135deg,#1e40af 0%,#3b82f6 100%);padding:24px 32px;color:#fff">
              <div style="font-size:22px;font-weight:800;letter-spacing:-0.5px">🚚 GoFuvar</div>
              <div style="font-size:13px;opacity:0.85;margin-top:4px">Ha fuvar kell, akkor GoFuvar.</div>
            </td>
          </tr>
          <tr>
            <td style="padding:32px">
              ${heading ? `<h1 style="margin:0 0 16px;font-size:20px;line-height:1.3;color:#0f172a">${heading}</h1>` : ''}
              <div style="font-size:14px;line-height:1.6;color:#334155">${bodyHtml}</div>
              ${cta}
            </td>
          </tr>
          <tr>
            <td style="padding:20px 32px;border-top:1px solid #e2e8f0;background:#f8fafc;font-size:12px;color:#64748b">
              Ezt az üzenetet automatikusan küldte a GoFuvar. Ha nem te végezted ezt a műveletet, kérjük vedd fel velünk a kapcsolatot.
              <br><br>
              Adatkezelő: <strong>Tiszta Hód Kft.</strong> (6800 Hódmezővásárhely, Szántó Kovács János utca 144.) ·
              <a href="${getWebBase()}/adatkezeles" style="color:#64748b">Adatkezelési tájékoztató</a> ·
              <a href="mailto:info@gofuvar.hu" style="color:#64748b">info@gofuvar.hu</a>
              <br><br>
              © GoFuvar
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;
}

// ---------- Konkrét sablon-függvények per esemény ----------

function formatHuf(n) {
  return (n ?? 0).toLocaleString('hu-HU');
}

/**
 * Új ajánlat érkezett a feladó egyik fuvarára.
 */
async function sendBidReceivedEmail({ to, shipperName, jobTitle, jobId, carrierName, amountHuf }) {
  const heading = '🎯 Új ajánlat a fuvarodra!';
  const bodyHtml = `
    <p>Szia ${escapeHtml(shipperName) || 'GoFuvar felhasználó'}!</p>
    <p><strong>${escapeHtml(carrierName) || 'Egy szállító'}</strong> ajánlatot tett a(z) <strong>"${escapeHtml(jobTitle)}"</strong> fuvarodra.</p>
    <p style="font-size:24px;font-weight:800;color:#1e40af;margin:20px 0">${formatHuf(amountHuf)} Ft</p>
    <p>Nyisd meg a részleteket, hogy elfogadhasd vagy összehasonlíthasd más ajánlatokkal.</p>
  `;
  return sendEmail({
    to,
    subject: `Új ajánlat: ${formatHuf(amountHuf)} Ft – ${jobTitle}`,
    html: wrapHtml({
      heading,
      bodyHtml,
      ctaText: 'Ajánlatok megtekintése',
      ctaHref: `${getWebBase()}/dashboard/fuvar/${jobId}`,
    }),
  });
}

/**
 * Útvonal-figyelő találat: új fuvar a szállító által figyelt útvonalon.
 */
async function sendLaneAlertEmail({ to, carrierName, jobTitle, jobId, routeLabel, priceHuf }) {
  const heading = '🎯 Új fuvar a figyelt útvonaladon!';
  const bodyHtml = `
    <p>Szia ${escapeHtml(carrierName) || 'GoFuvar felhasználó'}!</p>
    <p>Új fuvar került ki, ami illeszkedik az egyik beállított útvonal-figyelődre:</p>
    <p style="font-size:18px;font-weight:800;margin:16px 0 4px">${escapeHtml(jobTitle)}</p>
    <p style="color:#475569;margin:0 0 12px">${escapeHtml(routeLabel)}</p>
    ${priceHuf ? `<p style="font-size:22px;font-weight:800;color:#1e40af;margin:8px 0">~${formatHuf(priceHuf)} Ft</p>` : ''}
    <p>Nézd meg, és adj be egy ajánlatot, mielőtt más viszi el!</p>
    <p style="color:#64748b;font-size:13px;margin-top:16px">Az útvonal-figyelőidet a profilod alól bármikor módosíthatod vagy kikapcsolhatod.</p>
  `;
  return sendEmail({
    to,
    subject: `Új fuvar: ${jobTitle}`,
    html: wrapHtml({
      heading,
      bodyHtml,
      ctaText: 'Fuvar megnézése',
      ctaHref: `${getWebBase()}/sofor/fuvar/${jobId}`,
    }),
  });
}

/**
 * A szállító ajánlatát elfogadta a feladó.
 */
async function sendBidAcceptedEmail({ to, carrierName, jobTitle, jobId, amountHuf }) {
  const heading = '🎉 Elfogadták az ajánlatodat!';
  const bodyHtml = `
    <p>Szia ${escapeHtml(carrierName) || 'GoFuvar felhasználó'}!</p>
    <p>Nagyszerű hírek — a(z) <strong>"${escapeHtml(jobTitle)}"</strong> fuvar feladója elfogadta az ajánlatodat!</p>
    <p style="font-size:24px;font-weight:800;color:#16a34a;margin:20px 0">${formatHuf(amountHuf)} Ft</p>
    <p>A teljes összeget <strong>közvetlenül a feladótól</strong> kapod — készpénzben vagy átutalással, ahogy megegyeztek. Amint a feladó megfizeti a kapcsolatfelvételi díjat, megkapjátok egymás elérhetőségét és elindulhatsz. A fuvart a felvételi fotóval és a 6 jegyű átvételi kóddal tudod majd lezárni.</p>
  `;
  return sendEmail({
    to,
    subject: `Elfogadva: ${jobTitle} – ${formatHuf(amountHuf)} Ft`,
    html: wrapHtml({
      heading,
      bodyHtml,
      ctaText: 'Fuvar megnyitása',
      ctaHref: `${getWebBase()}/sofor/fuvar/${jobId}`,
    }),
  });
}

/**
 * Fizetésre szólítás a FELADÓNAK: megegyezés született (vagy a szállító
 * elfogadta az ellenajánlatát), és a kapcsolatfelvételi díj még nincs
 * kifizetve. Ugyanez a sablon szolgál a megállapodáskori azonnali
 * értesítésre (reminderNo=0) ÉS a fizetetlen-emlékeztetőkre (1/2) —
 * ez a lépcső a platform bevétele, és ma itt akad el a legtöbb tranzakció.
 */
async function sendPaymentDueEmail({ to, shipperName, jobTitle, jobId, agreedPriceHuf, feeHuf, reminderNo = 0 }) {
  const heading = reminderNo === 0
    ? '🤝 Megvan a megegyezés — egy lépés van hátra'
    : (reminderNo >= 2 ? '⏰ Utolsó emlékeztető: a fuvarod fizetésre vár' : '⏰ Emlékeztető: a fuvarod fizetésre vár');
  const intro = reminderNo === 0
    ? `<p>A(z) <strong>"${escapeHtml(jobTitle)}"</strong> fuvarra megszületett a megállapodás${agreedPriceHuf ? ` <strong>${formatHuf(agreedPriceHuf)} Ft</strong> fuvardíjon` : ''}!</p>`
    : `<p>A(z) <strong>"${escapeHtml(jobTitle)}"</strong> fuvarodon már megvan a megállapodás, de a kapcsolatfelvételi díj még nincs kifizetve — a szállító addig nem tud elindulni.</p>`;
  const bodyHtml = `
    <p>Szia ${escapeHtml(shipperName) || 'GoFuvar felhasználó'}!</p>
    ${intro}
    <p>Már csak a <strong>kapcsolatfelvételi díjat</strong> kell megfizetned${feeHuf ? ` (<strong>${formatHuf(feeHuf)} Ft</strong>)` : ''} — utána azonnal megkapjátok egymás elérhetőségét, és indulhat a fuvar. A fuvardíjat magát <strong>közvetlenül a szállítónak</strong> fizeted majd — készpénzben vagy átutalással, ahogy megegyeztek —, azt a platform nem kezeli.</p>
    ${reminderNo >= 2 ? '<p style="color:#b45309">Ha nem fizeted meg a díjat, a megállapodás elévülhet, és a szállító másik fuvart vállalhat.</p>' : ''}
  `;
  return sendEmail({
    to,
    subject: reminderNo === 0
      ? `Megegyezés: ${jobTitle} — fizesd a kapcsolatfelvételi díjat`
      : `Emlékeztető: a(z) "${jobTitle}" fuvarod fizetésre vár`,
    html: wrapHtml({
      heading,
      bodyHtml,
      ctaText: 'Fizetés és folytatás',
      ctaHref: `${getWebBase()}/dashboard/fuvar/${jobId}`,
    }),
  });
}

/**
 * A feladó kifizette a licites fuvart → a szállító kap értesítést.
 */
async function sendJobPaidEmail({ to, carrierName, jobTitle, jobId, amountHuf, shipperName }) {
  const heading = '🤝 Indulhat a fuvar!';
  const bodyHtml = `
    <p>Szia ${escapeHtml(carrierName) || 'GoFuvar felhasználó'}!</p>
    <p><strong>${escapeHtml(shipperName) || 'A feladó'}</strong> kifizette a kapcsolatfelvételi díjat a(z) <strong>"${escapeHtml(jobTitle)}"</strong> fuvarhoz — mostantól látjátok egymás elérhetőségét.</p>
    <p style="font-size:24px;font-weight:800;color:#16a34a;margin:20px 0">${formatHuf(amountHuf)} Ft</p>
    <p>Indulhatsz! A fuvardíjat <strong>közvetlenül a feladótól</strong> kapod — készpénzben vagy átutalással, ahogy megegyeztek. A fuvart a felvételi fotóval és a 6 jegyű átvételi kóddal zárod le.</p>
  `;
  return sendEmail({
    to,
    subject: `Fizetés beérkezett: ${jobTitle}`,
    html: wrapHtml({
      heading,
      bodyHtml,
      ctaText: 'Fuvar részletei',
      ctaHref: `${getWebBase()}/sofor/fuvar/${jobId}`,
    }),
  });
}

/**
 * Díj-visszaigazolás a FELADÓNAK a kapcsolatfelvételi díj megfizetése után.
 *
 * Jogi szerepe van: a 45/2014. (II. 26.) Korm. rendelet 18. §-a szerint a
 * szerződés megkötését tartós adathordozón (emailben) vissza kell igazolni,
 * benne a fogyasztó 29. § (1) a) szerinti nyilatkozatával (azonnali
 * teljesítés kérése + az elállási jog elvesztésének tudomásulvétele).
 * A nyilatkozat szövege szó szerint az, amit a feladó a fizetésnél a
 * jelölőnégyzettel elfogadott (fee_consent_at időbélyeggel rögzítve).
 *
 * @param {object} p
 * @param {string} p.to — a feladó email címe
 * @param {string} [p.shipperName]
 * @param {string} p.jobTitle — a fuvar/foglalás címe
 * @param {number} p.feeHuf — a megfizetett kapcsolatfelvételi díj (bruttó Ft)
 * @param {number} [p.cashHuf] — a szállítónak készpénzben járó fuvardíj
 * @param {string} [p.paidAtIso] — a fizetés időpontja (ISO string)
 * @param {string} [p.detailsPath] — a fuvar/foglalás oldala (pl. /dashboard/fuvar/<id>)
 */
/**
 * A CIB kártyás fizetés KÖTELEZŐ banki adatsora (2026-09-29, CIB PR-2/B):
 * TrID, RC, RT, AMO + HUF, ANUM — a fix feliratok a közös forrásból
 * (data/cibFeliratok.js), mert a bank átvételi tesztje szó szerint keresi
 * őket. Kártyaadat (CNUM) SOHA nem kerül bele; a hiányzó érték „—".
 */
function bankiAdatsorHtml(bankiAdatok) {
  if (!bankiAdatok) return '';
  const ertek = {
    trid: bankiAdatok.trid,
    rc: bankiAdatok.rc,
    rt: bankiAdatok.rt,
    amo: Number.isFinite(Number(bankiAdatok.amo)) && bankiAdatok.amo != null
      ? `${formatHuf(bankiAdatok.amo)} ${CIB_FELIRATOK.penznem}` : null,
    anum: bankiAdatok.anum,
  };
  const sorok = CIB_ADATSOR_SORREND.map((k) => `
        <tr><td style="padding:4px 12px 4px 0;color:#475569;vertical-align:top">${escapeHtml(CIB_FELIRATOK[k])}</td>
            <td style="padding:4px 0;font-weight:600;vertical-align:top">${ertek[k] == null || ertek[k] === '' ? '—' : escapeHtml(String(ertek[k]))}</td></tr>`).join('');
  return `
    <div style="background:#f8fafc;border:1px solid #e2e8f0;border-radius:10px;padding:14px 16px;margin:16px 0;font-size:13px;line-height:1.5">
      <strong>A kártyás fizetés banki adatai</strong>
      <table style="border-collapse:collapse;margin-top:8px">${sorok}
      </table>
    </div>`;
}

async function sendFeeConfirmationEmail({
  to, shipperName, jobTitle, feeHuf, cashHuf, paidAtIso, detailsPath, bankiAdatok = null,
}) {
  const heading = '🧾 Díj-visszaigazolás — kapcsolatfelvételi díj megfizetve';
  const paidAtTxt = paidAtIso
    ? new Date(paidAtIso).toLocaleString('hu-HU', { timeZone: 'Europe/Budapest' })
    : new Date().toLocaleString('hu-HU', { timeZone: 'Europe/Budapest' });
  const bodyHtml = `
    <p>Szia ${escapeHtml(shipperName) || 'GoFuvar felhasználó'}!</p>
    <p>Ezúton visszaigazoljuk, hogy a(z) <strong>"${escapeHtml(jobTitle)}"</strong> fuvarhoz
    a kapcsolatfelvételi díjat megfizetted.</p>
    <p style="font-size:24px;font-weight:800;color:#16a34a;margin:20px 0">
      ${formatHuf(feeHuf)} Ft <span style="font-size:13px;font-weight:400;color:#666">(bruttó, bevezető ár)</span>
    </p>
    <p style="font-size:13px;color:#666;margin:0 0 16px">Fizetés időpontja: ${escapeHtml(paidAtTxt)}</p>
    ${bankiAdatsorHtml(bankiAdatok)}
    <p>A szolgáltatás (a szállító kapcsolatfelvételi adatainak átadása és a fuvar-folyamat
    elindítása) a fizetéssel <strong>teljesült</strong> — a szállító elérhetőségét a fuvar
    oldalán találod.</p>
    <div style="background:#f8fafc;border:1px solid #e2e8f0;border-radius:10px;padding:14px 16px;margin:16px 0;font-size:13px;line-height:1.6">
      <strong>A fizetéskor tett nyilatkozatod:</strong><br />
      „Kérem a szolgáltatás (kapcsolatfelvételi adatok átadása) azonnali teljesítését,
      és tudomásul veszem, hogy a teljesítés után elállási jogomat elvesztem
      (45/2014. Korm. rendelet 29. § (1) a)). A díj nem visszatérítendő; ha a fuvar a
      szállító hibájából hiúsul meg, díjmentesen választhatok másik szállítót ugyanerre a fuvarra."
    </div>
    ${cashHuf ? `<p>Emlékeztető: a fuvardíjat (<strong>${formatHuf(cashHuf)} Ft</strong>)
    <strong>közvetlenül a szállítónak</strong> fizeted — készpénzben vagy átutalással, ahogy
    megegyeztek; a GoFuvar a fuvardíjat nem kezeli.</p>` : ''}
    <p style="font-size:13px;color:#666">Ha a szállító visszalép vagy nem elérhető, a fuvar
    oldalán díjmentesen választhatsz másik szállítót ugyanerre a fuvarra — a díj másik
    fuvarra nem vihető át. A díjról a számlát külön küldjük. Részletek:
    <a href="${getWebBase()}/aszf">ÁSZF (4. és 6. pont)</a>.</p>
  `;
  return sendEmail({
    to,
    subject: `Díj-visszaigazolás: ${jobTitle} — ${formatHuf(feeHuf)} Ft`,
    html: wrapHtml({
      heading,
      bodyHtml,
      ctaText: 'Fuvar megnyitása',
      ctaHref: `${getWebBase()}${detailsPath || '/dashboard'}`,
    }),
  });
}

const SIKERTELEN_LEVEL = {
  sikertelen: {
    heading: '❌ A kártyás fizetés nem sikerült',
    targy: 'A kártyás fizetés nem sikerült',
    torzs: 'a kapcsolatfelvételi díj kártyás fizetése <strong>nem sikerült</strong> — a kártyádat <strong>nem terheltük</strong>.',
  },
  nem_terhelt: {
    heading: 'ℹ️ A kártyádat nem terheltük',
    targy: 'A kártyádat nem terheltük',
    torzs: 'a kártyás fizetést <strong>nem zártuk le</strong>, mert a fuvar közben megváltozott (például lemondták, '
      + 'vagy más lett a szállító vagy a díj) — a kártyádat <strong>nem terheltük</strong>. A zárolt összeget a '
      + 'bank magától feloldja; a kivonatodon pár napig függő tételként látszhat.',
  },
  // 2026-10-01 (a CIB PR-4 1. javítóköre): a bank JÓVÁHAGYTA a fizetést, de a
  // banki lezárási határidőn belül nem véglegesítettük (határidőn túli
  // jóváhagyás, vagy a zárási kérés egyszer sem jutott el a bankhoz). A
  // „nem sikerült" és a „fuvar megváltozott" szöveg itt hamis lenne — a
  // vásárló a bank oldalán épp sikert látott, a kártyáján zárolt összeg áll.
  nem_zart: {
    heading: 'ℹ️ A kártyádat nem terheltük',
    targy: 'A kártyádat nem terheltük',
    torzs: 'a bank a kártyás fizetést jóváhagyta, de a banki lezárási határidőn belül <strong>nem tudtuk '
      + 'véglegesíteni</strong> — a kártyádat <strong>nem terheltük</strong>. A zárolt összeget a bank magától '
      + 'feloldja; a kivonatodon pár napig függő tételként látszhat.',
  },
  // 2026-10-01 (a CIB PR-4 1. javítóköre): a bank jóváhagyta, de ugyanerre a
  // fuvarra egy MÁSIK kísérlet zárása volt folyamatban (masik_zaras) — a
  // „fuvar megváltozott" indok itt hamis volt. Újrapróbát NEM ajánlunk: a
  // másik kísérlet épp sikerülhet, vagy egyeztetés alatt állhat.
  masik_kiserlet: {
    heading: 'ℹ️ Ezzel a kísérlettel nem terheltük a kártyádat',
    targy: 'Ezzel a kísérlettel nem terheltük a kártyádat',
    torzs: 'a bank az egyik kártyás fizetésedet jóváhagyta, de <strong>nem zártuk le</strong>, mert ugyanerre a '
      + 'fuvarra egy másik fizetésed lezárása volt folyamatban — kétszer nem terhelünk. Ezzel a kísérlettel a '
      + 'kártyádat <strong>nem terheltük</strong>; a zárolt összeget a bank magától feloldja (a kivonatodon pár '
      + 'napig függő tételként látszhat). A díj állapotát a fuvar oldalán látod.',
  },
  // 2026-10-03 (CIB PR-5/B): a bank által jóváhagyott összeg eltért a díjtól —
  // a „fuvar megváltozott" indok itt hamis volt.
  osszeg_elteres: {
    heading: 'ℹ️ A kártyádat nem terheltük',
    targy: 'A kártyádat nem terheltük',
    torzs: 'a kártyás fizetést <strong>nem zártuk le</strong>, mert a bank által jóváhagyott összeg eltért a '
      + 'díjtól — a kártyádat <strong>nem terheltük</strong>. A zárolt összeget a bank magától feloldja; a '
      + 'kivonatodon pár napig függő tételként látszhat. A díj állapotát a fuvar oldalán látod; ha elakadtál, '
      + 'írj az info@gofuvar.hu címre.',
  },
  mar_fizetve: {
    heading: 'ℹ️ A díj már rendezve volt — nem terheltünk kétszer',
    targy: 'A díj már rendezve volt — nem terheltünk kétszer',
    torzs: 'a kapcsolatfelvételi díj már rendezve volt (egy korábbi fizetéssel vagy kuponnal), ezért ezt a '
      + 'kártyás fizetést <strong>nem zártuk le</strong> — kétszer nem terhelünk. A zárolt összeget a bank '
      + 'magától feloldja; a kivonatodon pár napig függő tételként látszhat.',
  },
  // 2026-10-03 (CIB PR-5, C5): az admin a bankkal egyeztetve „nem zárult le"-ként
  // rendezte a kétes kísérletet — a „fuvar megváltozott" indok itt hamis volt.
  admin_nem_lezarva: {
    heading: 'ℹ️ A kártyádat nem terheltük',
    targy: 'A kártyádat nem terheltük',
    torzs: 'a kártyás fizetést <strong>nem tudtuk véglegesíteni</strong> — a bankkal egyeztetve a kártyádat '
      + '<strong>nem terheltük</strong>. Ha a bank zárolta az összeget, magától feloldja; a kivonatodon pár napig '
      + 'függő tételként látszhat.',
  },
  // 2026-10-03 (CIB PR-5, C5): az automatikus egyeztetés szerint a bank a le nem
  // zárt jóváhagyást visszafordította.
  bank_visszaforditotta: {
    heading: 'ℹ️ A kártyádat nem terheltük',
    targy: 'A kártyádat nem terheltük',
    // 2026-10-03: semleges — az elutasított eredetű egyeztetésre is igaz.
    torzs: 'a kártyás fizetést a bank <strong>nem terhelte</strong>, így a '
      + 'kártyádat <strong>nem terheltük</strong>. Ha a bank zárolta az összeget, feloldja; a kivonatodon pár napig '
      + 'függő tételként látszhat.',
  },
  // 2026-10-03 (CIB PR-5): a kétes (close_unknown) kísérlet közbenső értesítése.
  egyeztetes: {
    heading: 'ℹ️ A kártyás fizetésed egyeztetés alatt',
    targy: 'A kártyás fizetésed egyeztetés alatt',
    torzs: 'a kártyás fizetés lezárásáról a banktól nem kaptunk egyértelmű választ, ezért <strong>egyeztetjük</strong>. '
      + '<strong>Ne fizess újra</strong> — kétszer biztosan nem terhelünk, és az eredményről külön értesítünk.',
  },
  // 2026-10-03 (CIB PR-5): a könyvelési árva díját az admin visszatérítette.
  visszateritve: {
    heading: 'ℹ️ A díjat visszatérítettük',
    targy: 'A díjat visszatérítettük',
    torzs: 'a kapcsolatfelvételi díjat a bank terhelte, de a fuvar közben már nem volt fizethető, ezért a díjat '
      + '<strong>visszatérítettük a kártyádra</strong>. A jóváírás ideje a bankodtól függ.',
  },
};

/**
 * Sikertelen / nem terhelt kártyás kísérlet (2026-09-29, CIB PR-2/B) — a
 * bank által előírt adatsorral és az RC-csoport szerinti magyarázattal.
 * Csak akkor megy ki, ha a kísérlet eljutott a bankig (a hívó ellenőrzi,
 * egyszeri claimmel). Kártyaadat nincs benne.
 */
async function sendFeePaymentFailedEmail({
  to, shipperName, jobTitle, jobId, bankiAdatok, rcCsoport = null, tipus = 'sikertelen',
}) {
  const l = SIKERTELEN_LEVEL[tipus] || SIKERTELEN_LEVEL.sikertelen;
  const x0 = bankiAdatok && String(bankiAdatok.rc || '').toUpperCase() === 'X0';
  const magyarazat = tipus === 'sikertelen'
    ? (x0 ? X0_UZENET : RC_CSOPORT_UZENET[rcCsoport] || RC_CSOPORT_UZENET.kapcsolat)
    : null;
  // A le nem zárt (nem_zart) kísérlet után is új fizetés indítható — a
  // banki újrapróba felkínálása ott is kötelező (2026-10-03, PR-5: az admin-
  // rendezés és a bank visszafordítása után is).
  const ujra = ['sikertelen', 'nem_zart', 'admin_nem_lezarva', 'bank_visszaforditotta'].includes(tipus);
  const bodyHtml = `
    <p>Szia ${escapeHtml(shipperName) || 'GoFuvar felhasználó'}!</p>
    <p>A(z) <strong>"${escapeHtml(jobTitle)}"</strong> fuvarnál ${l.torzs}</p>
    ${magyarazat ? `<p style="font-size:13px;color:#475569">${escapeHtml(magyarazat)}</p>` : ''}
    ${bankiAdatsorHtml(bankiAdatok)}
    ${ujra ? '<p>Új fizetést a fuvar oldalán egy kattintással indíthatsz — a korábbi kísérlet nem akadályozza.</p>' : ''}
  `;
  return sendEmail({
    to,
    subject: `${l.targy}: ${jobTitle}`,
    html: wrapHtml({
      heading: l.heading,
      bodyHtml,
      ctaText: ujra ? 'Új fizetés indítása' : 'Fuvar megnyitása',
      ctaHref: `${getWebBase()}/dashboard/fuvar/${encodeURIComponent(jobId || '')}${ujra ? '?fizetes=ujra' : ''}`,
    }),
  });
}

// A TrID NÉLKÜLI riasztás RENDSZER-szintű (2026-09-29, CIB PR-2/C): nem egy
// fuvar kézi egyeztetéséről szól, hanem arról, hogy a kártyás fizetés épp
// nem indítható. Eddig ugyanaz a „fuvar fagyasztva, rendezd ANUM-mal" szöveg
// ment ki rájuk — éjjel félrevezetné azt, aki reagál.
const CIB_RENDSZER_RIASZTAS = Object.freeze({
  szivveres: {
    targy: 'a CIB lekérdező kör nem fut',
    szoveg: 'A CIB lekérdező kör 3 perce nem futott le sikeresen (vagy az indulás óta egyszer sem). Amíg nem fut, '
      + 'a kártyás fizetés 503-at ad, és a már jóváhagyott tételek lezárása is áll — a bank a MSGT10-től számított '
      + '10 perces lezárási határidő után visszautal, terhelés nem marad. Nézd meg a Railway-logot (DB-kapcsolat, '
      + 'migráció, összeomlási ciklus).',
  },
  // 2026-10-01 (a CIB írásos válasza): IP-regisztráció nincs, a teszt- és az
  // éles végpont is a 443-as porton érhető el — ezek nem gyanúokok.
  megszakito: {
    targy: 'a CIB-kapcsolat megszakítója nyitva',
    szoveg: 'Több egymás utáni banki kapcsolati vagy S-hiba után a megszakító nyitva: 10 percig nem indul új '
      + 'kártyás fizetés. Valószínű ok: a kimenő hálózat (DNS, TLS) hibája, felcserélt teszt/éles kulcs vagy '
      + 'rossz környezet (CIB_MARKET_URL).',
  },
  // 2026-10-03 (CIB PR-5)
  bank_rendszerhiba: {
    targy: 'a bank tartósan elutasítja az üzeneteinket',
    szoveg: 'A bank egymás után több kártyás üzenetünkre D-kóddal, RC nélküli HTTP-hibával vagy ismételt D04-gyel '
      + 'válaszolt (rendszerszintű hiba). Amíg tart, a jóváhagyott tételek nem zárhatók le (a bank a határidő után '
      + 'visszautal, terhelés nem marad), és az új fizetések is elbukhatnak. Nézd meg a CIB admin-naplót (TrID-nként '
      + 'a banki üzenetek), és egyeztess a bankkal (ecommerce@cib.hu) a terminál beállításairól.',
  },
  arva_kiserletek: {
    targy: 'konfig nélkül maradt kártyás kísérletek',
    szoveg: 'A CIB EKI nem működik (a CIB-konfiguráció hiányos vagy hibás, vagy a fizetési szolgáltató nem CIB), '
      + 'de maradt nem végső kártyás kísérlet — ezeket a lekérdező kör nem zárja le. Állítsd vissza a CIB-konfigot, '
      + 'vagy rendezd a tételeket az adminban (Fizetések → CIB: könyvelés, lejáratás, rendezés, visszatérítés).',
  },
  // 2026-10-03 (CIB PR-5): ÉLŐ konfig mellett a CIB_BEVEZETES előtti nem
  // végső kísérletek — eddig ugyanaz az „a CIB EKI nem működik, állítsd
  // vissza" szöveg ment, ami az élesítés napján (recept: CIB_BEVEZETES =
  // aznap) a teljes visszaállásra késztethette az ügyeletest.
  arva_bevezetes_elott: {
    targy: 'a CIB_BEVEZETES előtti függő kártyás kísérletek',
    szoveg: 'CIB_BEVEZETES előtti függő kísérlet — rendezd az adminban vagy állítsd korábbra a CIB_BEVEZETES-t. '
      + 'A CIB EKI-konfiguráció teljes, a kártyás fizetés fut; a lekérdező kör viszont csak a CIB_BEVEZETES napja '
      + 'óta indult kísérletekhez nyúl, így az ennél régebbi, nem végső kísérleteket (kétes, könyveletlen, '
      + 'felülvizsgálandó) semmi nem zárja le. Rendezd őket az adminban (Fizetések → CIB: könyvelés, lejáratás, '
      + 'rendezés, visszatérítés), vagy állítsd korábbra a CIB_BEVEZETES dátumát.',
  },
  napi_emlekezteto: {
    targy: 'rendezetlen kártyás tételek (napi emlékeztető)',
    szoveg: 'Az alábbi kártyás tételek több mint 24 órája rendezetlenek (kétes zárás, könyvelési árva vagy tartós '
      + 'könyvelési hiba). A feladót „egyeztetjük" üzenet tartja vissza az új fizetéstől — rendezd őket az adminban '
      + '(Fizetések → CIB).',
  },
});

// A TrID-s riasztás teendője az ok szerint (2026-10-03, CIB PR-5): a
// könyvelési árvánál és a könyvelési hibánál a „lezárva (ANUM-mal) / nem
// zárult le" utasítás lehetetlen vagy félrevezető lépés volt.
const CIB_TRID_TEENDO = Object.freeze({
  konyvelesi_arva: 'A bank <strong>terhelt</strong>, de az ügylet már nem fizethető (könyvelési árva). A díjat a '
    + 'banknál vissza kell téríteni, majd az adminban (Fizetések → CIB) a „Visszatérítve" művelettel, indoklással '
    + 'és banki hivatkozással lezárni — a feladó erről értesítést kap.',
  konyvelesi_hiba: 'A bank lezárta (<strong>terhelt</strong>), de a könyvelés ismételten elbukik. A rendszer '
    + 'visszalépéssel újrapróbálja; ha nem áll helyre, nézd a naplót, és az adminban a „Könyvelés" művelettel '
    + 'próbáld újra (banki hívás nincs).',
  nt_ismetlodo: 'A bank a lekérdezésre ismételten nem találja a tranzakciót (saját hiba gyanú: PID, kulcs, összeg). '
    + 'MSGT32 nem ment ki, terhelés nincs; a kísérlet a zárási határidő után magától lezárul, a feladót nem '
    + 'blokkolja. Ellenőrizd a CIB-konfigurációt.',
  lekerdezes_mezo_elteres: 'A bank lekérdezésre adott válasza ismételten eltér a tárolt adatoktól (saját hiba '
    + 'gyanú). MSGT32 nem ment ki, terhelés nincs; a kísérlet a zárási határidő után magától lezárul, a feladót '
    + 'nem blokkolja. Ellenőrizd a CIB-konfigurációt.',
  // 2026-10-04 (a PR-5 2. javítóköre): eddig ez a két ok a levélben az
  // általános „a rendszer automatikusan eldönti" szöveget kapta — épp ott,
  // ahol a rendszer már NEM dönt (a teendő-szótár a cibFizetes
  // RIASZTAS_TEENDO-jával szinkronban, őr: cib-pr5-javitokor-2.test.js).
  egyeztetes_nem_dontheto: 'A kétes zárás csak-olvasó egyeztetése (MSGT33) ellentmondó választ adott (TO-tól eltérő '
    + 'elutasító kód, mezőeltérés, eltérő ANUM, vagy TO egy D05-tel — „már kiszolgálva" — kétes kísérletre): a kártya '
    + '<strong>terhelt lehet</strong>. A fuvar fagyasztva, a kontakt rejtve, újrafizetés nem indul, és a rendszer '
    + 'magától NEM dönt. Egyeztess a bankkal (TrID), majd az adminban (Fizetések → CIB) rendezd: „lezárva" '
    + '(ANUM-mal) vagy „nem zárult le".',
  egyeztetes_iras_utkozes: 'Az egyeztetés szerint a bank lezárta (<strong>terhelt</strong>), de a tétel állapota '
    + 'közben megváltozott (pl. admin-rendezés), így az eredmény nem rögzíthető. Ellenőrizd a tételt az adminban '
    + '(Fizetések → CIB) és a banknál: ha a díj nem könyvelődött, a banknál vissza kell téríteni. Ha közben „nem '
    + 'zárult le" rendezés történt, a feladó „nem terheltük" értesítést kapott — a visszatérítéssel együtt tájékoztasd.',
  // 2026-10-03 (I2): a MSGT32-re kapott sikeres válasz nem rögzíthető.
  zaras_iras_utkozes: 'A bank a zárási kérésünkre (MSGT32) 00-val válaszolt (<strong>terhelt</strong>), de a tétel '
    + 'állapota közben megváltozott (pl. kézi lejáratás vagy rendezés), így a sikert nem rögzíthettük. Ellenőrizd a '
    + 'tételt az adminban (Fizetések → CIB) és a banknál: ha a díj nem könyvelődött, a banknál vissza kell téríteni; '
    + 'ha a feladó közben újra fizetett, a kettős terhelést is rendezni kell, és tájékoztasd a feladót.',
});
// Az okok, amelyeknél a bankkal kell egyeztetni (a levél tárgya „kézi egyeztetés").
const CIB_KEZI_EGYEZTETES_OKOK = Object.freeze(['egyeztetes_nem_dontheto', 'egyeztetes_iras_utkozes', 'zaras_iras_utkozes']);
const CIB_KETES_TEENDO = 'A fuvar fagyasztva, a kontakt rejtve; MSGT32 újraküldés nincs. A rendszer az utolsó MSGT32 '
  + 'után CIB_EGYEZTETES_PERC (alapból 25) perccel csak-olvasó lekérdezéssel (MSGT33) automatikusan eldönti: TO → nem '
  + 'terhelt (a D05-tel kétes kísérletnél nem), két (legalább 15 perc különbségű) 00 ugyanazzal az ANUM-mal → lezárt. '
  + 'Ha az sem dönt (más banki kód, eltérő ANUM), egyeztess a bankkal, majd az adminban (Fizetések → CIB) rendezd: '
  + '„lezárva" (ANUM-mal) vagy „nem zárult le".';

/**
 * A CIB-riasztó levél tárgya és HTML-je (2026-10-03, PR-5 — külön, hogy a
 * teendő-szöveg tesztelhető legyen). Csak TrID, fuvar-azonosító, állapot-kód
 * és darabszám kerül bele — személyes adat soha.
 * @returns {{subject:string, html:string}}
 */
function cibRiasztasTartalom({
  trid, jobId, ok, reszletek = null,
}) {
  const reszletHtml = reszletek
    ? `<p style="font-size:13px">Részletek: ${escapeHtml(Array.isArray(reszletek) ? reszletek.join(', ') : String(reszletek))}</p>`
    : '';
  if (!trid) {
    const rendszer = CIB_RENDSZER_RIASZTAS[ok] || null;
    const bodyHtml = `
    <p><strong>Rendszer-riasztás</strong> (${escapeHtml(ok || '?')}): ${escapeHtml(rendszer ? rendszer.szoveg : 'a kártyás fizetés üzemzavara.')}</p>
    ${reszletHtml}
    ${jobId ? `<p>Érintett fuvar: ${escapeHtml(jobId)}</p>` : ''}
    <p>Ha közben kétes kísérlet keletkezik, arról külön, TrID-s levél megy.</p>
  `;
    return {
      subject: `[GoFuvar] CIB rendszer-riasztás: ${rendszer ? rendszer.targy : 'üzemzavar'}`,
      html: wrapHtml({
        heading: '🚨 Kártyás fizetés — rendszer-riasztás',
        bodyHtml,
        ctaText: 'Admin megnyitása',
        ctaHref: `${getWebBase()}/admin#fizetesek`,
      }),
    };
  }
  const maszk = `…${String(trid).slice(-4)}`;
  const ketes = !CIB_TRID_TEENDO[ok] || CIB_KEZI_EGYEZTETES_OKOK.includes(ok);
  const teendo = CIB_TRID_TEENDO[ok] || CIB_KETES_TEENDO;
  const bodyHtml = `
    <p>Egy kártyás díjfizetés <strong>${ketes ? 'kézi egyeztetést' : 'teendőt'}</strong> igényel (${escapeHtml(ok || '?')}).</p>
    <table style="border-collapse:collapse;font-size:13px">
      <tr><td style="padding:4px 12px 4px 0">${escapeHtml(CIB_FELIRATOK.trid)}</td><td><strong>${escapeHtml(trid || '—')}</strong></td></tr>
      <tr><td style="padding:4px 12px 4px 0">Fuvar</td><td>${escapeHtml(jobId || '—')}</td></tr>
    </table>
    <p>${teendo}</p>
    ${reszletHtml}
  `;
  return {
    subject: ketes ? `[GoFuvar] CIB-fizetés kézi egyeztetést igényel (${maszk})` : `[GoFuvar] CIB-fizetés: teendő (${maszk})`,
    html: wrapHtml({
      heading: ketes ? '🚨 Kártyás fizetés — kézi egyeztetés' : '🚨 Kártyás fizetés — teendő',
      bodyHtml,
      ctaText: 'Admin megnyitása',
      ctaHref: `${getWebBase()}/admin#fizetesek`,
    }),
  };
}

/**
 * Belső riasztás (2026-09-29, CIB PR-2/B): egy kártyás fizetés kétes
 * (close_unknown) vagy könyvelési árva — ember dönt, a bankkal egyeztetve.
 * CSAK a TrID és a fuvar azonosítója megy ki, személyes adat nem.
 * TrID nélkül (PR-2/C) rendszer-riasztás: `ok` = szivveres | megszakito.
 */
async function sendCibRiasztasEmail({
  to, trid, jobId, ok, reszletek = null,
}) {
  const { subject, html } = cibRiasztasTartalom({
    trid, jobId, ok, reszletek,
  });
  return sendEmail({ to, subject, html });
}

/**
 * Új foglalás érkezett a szállító egyik járatára.
 */
async function sendBookingReceivedEmail({ to, carrierName, routeTitle, routeId, shipperName, priceHuf }) {
  const heading = '📦 Új foglalás érkezett!';
  const bodyHtml = `
    <p>Szia ${escapeHtml(carrierName) || 'GoFuvar felhasználó'}!</p>
    <p><strong>${escapeHtml(shipperName) || 'Egy feladó'}</strong> foglalt helyet a(z) <strong>"${escapeHtml(routeTitle)}"</strong> járatodra.</p>
    <p style="font-size:24px;font-weight:800;color:#1e40af;margin:20px 0">${formatHuf(priceHuf)} Ft</p>
    <p>Erősítsd meg a foglalást — a feladó a kapcsolatfelvételi díj megfizetése után látja az elérhetőségedet, a fuvardíjat közvetlenül tőle kapod (készpénz vagy átutalás, ahogy megegyeztek).</p>
  `;
  return sendEmail({
    to,
    subject: `Új foglalás: ${routeTitle}`,
    html: wrapHtml({
      heading,
      bodyHtml,
      ctaText: 'Foglalás megtekintése',
      ctaHref: `${getWebBase()}/sofor/utvonal/${routeId}`,
    }),
  });
}

/**
 * A szállító megerősítette a foglalást → feladó tud fizetni.
 */
async function sendBookingConfirmedEmail({
  to, shipperName, routeTitle, bookingId, carrierName, priceHuf, kartyasFizetesElerheto = true,
}) {
  const heading = '✅ A szállító megerősítette a foglalásod!';
  // 2026-10-03 (CIB PR-5/B): a kártyás (CIB) úton a foglalás díja még nem
  // fizethető — a „Fizetés most" gomb ott lehetetlen felhívás lenne.
  const fizetes = kartyasFizetesElerheto
    ? '<p>Most tudod megfizetni a kapcsolatfelvételi díjat — utána megkapod a szállító elérhetőségét, a fuvardíjat pedig közvetlenül neki fizeted (készpénz vagy átutalás, ahogy megegyeztek). A foglalásod a "Foglalásaim" menüpontban érhető el.</p>'
    : '<p>A járat-foglalások kapcsolatfelvételi díját kártyával egyelőre nem lehet kifizetni, ezért a szállító elérhetőségét még nem tudjuk megmutatni. Ha segítség kell, írj az <a href="mailto:info@gofuvar.hu">info@gofuvar.hu</a> címre. A foglalásod a "Foglalásaim" menüpontban érhető el.</p>';
  const bodyHtml = `
    <p>Szia ${escapeHtml(shipperName) || 'GoFuvar felhasználó'}!</p>
    <p><strong>${escapeHtml(carrierName) || 'A szállító'}</strong> elfogadta a foglalásodat a(z) <strong>"${escapeHtml(routeTitle)}"</strong> járaton.</p>
    <p style="font-size:24px;font-weight:800;color:#16a34a;margin:20px 0">${formatHuf(priceHuf)} Ft</p>
    ${fizetes}
  `;
  return sendEmail({
    to,
    subject: `Megerősítve: ${routeTitle}`,
    html: wrapHtml({
      heading,
      bodyHtml,
      ctaText: kartyasFizetesElerheto ? 'Fizetés most' : 'Foglalásaim',
      ctaHref: `${getWebBase()}/dashboard/foglalasaim`,
    }),
  });
}

/**
 * A feladó kifizette a fix áras foglalást → szállító kap értesítést.
 */
async function sendBookingPaidEmail({ to, carrierName, routeTitle, bookingId, priceHuf, shipperName }) {
  const heading = '🤝 Indulhat a foglalás!';
  const bodyHtml = `
    <p>Szia ${escapeHtml(carrierName) || 'GoFuvar felhasználó'}!</p>
    <p><strong>${escapeHtml(shipperName) || 'A feladó'}</strong> kifizette a kapcsolatfelvételi díjat a(z) <strong>"${escapeHtml(routeTitle)}"</strong> járatodra szóló foglaláshoz.</p>
    <p style="font-size:24px;font-weight:800;color:#16a34a;margin:20px 0">${formatHuf(priceHuf)} Ft</p>
    <p>A fuvardíjat <strong>közvetlenül a feladótól</strong> kapod — készpénzben vagy átutalással, ahogy megegyeztek.</p>
  `;
  return sendEmail({
    to,
    subject: `Fizetés beérkezett: ${routeTitle}`,
    html: wrapHtml({ heading, bodyHtml }),
  });
}

/**
 * Foglalás elutasítva — a feladó kap értesítést.
 */
async function sendBookingRejectedEmail({ to, shipperName, routeTitle }) {
  const heading = 'A szállító elutasította a foglalásod';
  const bodyHtml = `
    <p>Szia ${escapeHtml(shipperName) || 'GoFuvar felhasználó'}!</p>
    <p>Sajnáljuk, de a szállító elutasította a foglalásodat a(z) <strong>"${escapeHtml(routeTitle)}"</strong> útvonalon. Nem volt pénzmozgás — semmit nem kell tenned.</p>
    <p>Ne csüggedj! Nézz körül az "Útba eső szállítók" menüpontban — rengeteg más útvonal közül választhatsz.</p>
  `;
  return sendEmail({
    to,
    subject: `Elutasítva: ${routeTitle}`,
    html: wrapHtml({
      heading,
      bodyHtml,
      ctaText: 'Másik útvonal keresése',
      ctaHref: `${getWebBase()}/dashboard/utvonalak`,
    }),
  });
}

/**
 * Lemondás értesítés — a másik fél kapja meg az infót.
 * @param {object} opts
 * @param {string} opts.to – címzett email
 * @param {string} opts.recipientName – címzett neve
 * @param {string} opts.jobTitle – a fuvar/útvonal címe
 * @param {'shipper'|'carrier'} opts.cancelledByRole – ki mondta le
 * @param {number} opts.refundHuf – a feladónak visszautalt összeg
 * @param {number} opts.feeHuf – a levont lemondási díj
 * @param {boolean} opts.recipientIsShipper – a címzett a feladó-e
 */
async function sendCancellationEmail({
  to,
  recipientName,
  jobTitle,
  cancelledByRole,
  refundHuf,
  feeHuf,
  recipientIsShipper,
}) {
  const whoCancelled = cancelledByRole === 'shipper' ? 'a feladó' : 'a szállító';
  const heading = '❌ Fuvar lemondva';
  let bodyHtml = `
    <p>Szia ${escapeHtml(recipientName) || 'GoFuvar felhasználó'}!</p>
    <p>Az alábbi fuvart <strong>${whoCancelled}</strong> lemondta:
    <strong>"${escapeHtml(jobTitle)}"</strong>.</p>
  `;
  if (recipientIsShipper) {
    bodyHtml += `
      <p>Pénzmozgás nem történt a lemondással: a fuvardíj közvetlenül a szállítónak járt volna, a platformon át nem folyik, így nincs mit visszatéríteni. Ha már fizettél kapcsolatfelvételi díjat, az a fuvarra érvényes marad — a fuvar oldalán díjmentesen választhatsz másik szállítót a korábbi ajánlatok közül.</p>
    `;
  }
  if (!recipientIsShipper) {
    bodyHtml += `
      <p>Az útvonaladon/fuvarodon lévő foglalás visszavonásra került. Nincs további teendőd.</p>
    `;
  }
  return sendEmail({
    to,
    subject: `Lemondva: ${jobTitle}`,
    html: wrapHtml({ heading, bodyHtml }),
  });
}

async function sendRecipientTrackingEmail({ to, recipientName, jobTitle, trackingUrl, deliveryCode }) {
  return sendEmail({
    to,
    subject: `📦 Csomag érkezik hozzád — ${jobTitle}`,
    html: `
      <div style="font-family:sans-serif;max-width:500px;margin:0 auto;padding:20px">
        <h2>Szia${recipientName ? ` ${escapeHtml(recipientName)}` : ''}! 👋</h2>
        <p>Csomag van úton hozzád a <strong>GoFuvar</strong> platformon keresztül.</p>
        <p style="font-size:14px;color:#666">Fuvar: <strong>${escapeHtml(jobTitle)}</strong></p>
        ${deliveryCode ? `<div style="background:#f0fdf4;border:2px solid #16a34a;border-radius:12px;padding:20px;text-align:center;margin:20px 0">
          <div style="font-size:13px;color:#666;margin-bottom:8px">Átvételi kód</div>
          <div style="font-size:36px;font-weight:800;letter-spacing:6px;font-family:monospace">${escapeHtml(deliveryCode)}</div>
          <div style="font-size:12px;color:#666;margin-top:8px">Ezt a kódot add meg a szállítónak amikor megérkezik</div>
        </div>` : `<p style="font-size:14px;color:#444">Amikor a szállító felveszi a csomagot, e-mailben és SMS-ben elküldjük a <strong>6 jegyű átvételi kódot</strong> és a szállító elérhetőségét. A kódot csak az átadáskor add meg neki.</p>`}
        <a href="${escapeHtml(trackingUrl)}" style="display:block;text-align:center;background:#1e40af;color:#fff;padding:14px;border-radius:8px;text-decoration:none;font-weight:700;font-size:16px">
          📍 Küldemény követése
        </a>
        <p style="font-size:12px;color:#999;margin-top:20px;text-align:center">
          Ezen az oldalon követheted a küldemény állapotát. Nem kell regisztrálnod a GoFuvarra.
        </p>
        <!-- GDPR 14. cikk — a címzett NEM felhasználó: tőle nem kaptunk adatot,
             és semmilyen dokumentumot nem fogadott el. Ezért neki külön meg kell
             mondani, KI kezeli az adatait, HONNAN vannak, MEDDIG tartjuk meg, és
             hogyan tiltakozhat. (2026-08-09 adatvédelmi audit: eddig egyik
             kötelező elem sem szerepelt sem az e-mailben, sem az SMS-ben.) -->
        ${cimzettiTajekoztatoBlokk()}
      </div>
    `,
  });
}

/**
 * A CÍMZETT felvételi e-mailje (2026-09-11, teljes audit A4): a csomag
 * felvételekor — az SMS párja — a 6 jegyű átvételi kóddal és a szállító
 * elérhetőségével. A feladáskori levél (fent) kód nélkül megy.
 */
async function sendRecipientPickupEmail({
  to, recipientName, jobTitle, trackingUrl, deliveryCode, carrierName, carrierPhone,
}) {
  return sendEmail({
    to,
    // (D1, 2026-09-13) A kód NEM a tárgyban: a tárgy értesítés-előnézetben,
    // zárolt képernyőn, levelező-listában is látszik — a kód a törzsben van.
    subject: `🚚 Úton a csomagod — ${jobTitle}`,
    html: `
      <div style="font-family:sans-serif;max-width:500px;margin:0 auto;padding:20px">
        <h2>Szia${recipientName ? ` ${escapeHtml(recipientName)}` : ''}! 🚚</h2>
        <p>A szállító felvette a csomagot — <strong>úton van hozzád</strong>.</p>
        <p style="font-size:14px;color:#666">Fuvar: <strong>${escapeHtml(jobTitle)}</strong></p>
        <div style="background:#f0fdf4;border:2px solid #16a34a;border-radius:12px;padding:20px;text-align:center;margin:20px 0">
          <div style="font-size:13px;color:#666;margin-bottom:8px">Átvételi kód</div>
          <div style="font-size:36px;font-weight:800;letter-spacing:6px;font-family:monospace">${escapeHtml(deliveryCode)}</div>
          <div style="font-size:12px;color:#666;margin-top:8px"><strong>Csak az átadáskor add meg a szállítónak</strong> — előre bediktálva a kód elveszti a bizonyíték-értékét.</div>
        </div>
        ${(carrierName || carrierPhone) ? `<p>🚗 Szállító: <strong>${escapeHtml(carrierName || '')}</strong>${carrierPhone ? ` — <a href="tel:${escapeHtml(carrierPhone)}">${escapeHtml(carrierPhone)}</a>` : ''}<br><span style="font-size:13px;color:#666">Egyeztess vele az érkezésről!</span></p>` : ''}
        <a href="${escapeHtml(trackingUrl)}" style="display:block;text-align:center;background:#1e40af;color:#fff;padding:14px;border-radius:8px;text-decoration:none;font-weight:700;font-size:16px">
          📍 Küldemény követése
        </a>
        ${cimzettiTajekoztatoBlokk()}
      </div>
    `,
  });
}

/**
 * Email-megerősítés link új regisztrációkor (vagy újraküldés).
 */
async function sendEmailVerificationEmail({ to, fullName, verifyUrl }) {
  const heading = '👋 Üdv a GoFuvarnál — erősítsd meg az email címedet';
  const bodyHtml = `
    <p>Szia ${escapeHtml(fullName) || 'GoFuvar felhasználó'}!</p>
    <p>Köszönjük, hogy regisztráltál! Egy utolsó lépés van hátra: kattints az alábbi
    gombra, hogy megerősítsd az e-mail címedet. E nélkül nem tudunk neked
    fontos értesítéseket küldeni (új ajánlat, fizetés, stb.).</p>
    <p style="font-size:13px;color:#64748b;margin-top:16px">A link 7 napig érvényes. Ha nem te regisztráltál, hagyd figyelmen kívül ezt az emailt.</p>
  `;
  return sendEmail({
    to,
    subject: 'Erősítsd meg az email címedet — GoFuvar',
    html: wrapHtml({
      heading,
      bodyHtml,
      ctaText: 'Email megerősítése',
      ctaHref: verifyUrl,
    }),
  });
}

/**
 * Jelszó-visszaállítás link.
 */
async function sendPasswordResetEmail({ to, fullName, resetUrl }) {
  const heading = '🔑 Jelszó visszaállítása';
  const bodyHtml = `
    <p>Szia ${escapeHtml(fullName) || 'GoFuvar felhasználó'}!</p>
    <p>Egy kérelem érkezett a jelszavad visszaállítására. Kattints az alábbi
    gombra, hogy új jelszót adhass meg.</p>
    <p style="font-size:13px;color:#64748b;margin-top:16px">A link <strong>30 percig</strong> érvényes. Ha nem te kérted ezt, hagyd figyelmen kívül — a jelszavadat senki nem tudja megváltoztatni a link nélkül.</p>
  `;
  return sendEmail({
    to,
    subject: 'Jelszó visszaállítása — GoFuvar',
    html: wrapHtml({
      heading,
      bodyHtml,
      ctaText: 'Új jelszó beállítása',
      ctaHref: resetUrl,
    }),
  });
}

/**
 * DAC7 adóazonosító-bekérő / emlékeztető a magánszemély SZÁLLÍTÓNAK.
 * reminderNo: 0 = első kérés (az első teljesített fuvar után),
 * 1 = első emlékeztető, 2 = utolsó emlékeztető (blokkolás-figyelmeztetéssel).
 */
async function sendTaxDataRequestEmail({ to, name, deadline, reminderNo = 0 }) {
  const deadlineStr = deadline instanceof Date ? deadline.toLocaleDateString('hu-HU') : String(deadline || '');
  const heading = reminderNo === 0
    ? '🧾 Egy adat még hiányzik: adóazonosító jel'
    : (reminderNo >= 2 ? '🧾 Utolsó emlékeztető: adóazonosító jel' : '🧾 Emlékeztető: adóazonosító jel');
  const intro = reminderNo === 0
    ? `<p>Gratulálunk az első teljesített fuvarodhoz! 🎉</p>
       <p>A GoFuvar mint platformüzemeltető <strong>jogszabályi kötelezettség</strong> (az EU DAC7-irányelve, itthon az Aktv.) alapján köteles a szállítók adóügyi adatait rögzíteni és évente a NAV felé jelenteni.</p>`
    : `<p>Korábban kértük, hogy add meg az adóügyi adataidat — ez még nem történt meg.</p>`;
  const consequence = reminderNo >= 2
    ? `<p style="color:#b45309"><strong>Fontos:</strong> ha <strong>${escapeHtml(deadlineStr)}</strong>-ig nem adod meg, a jogszabály alapján az új ajánlattételi lehetőségedet fel kell függesztenünk, amíg az adat meg nem érkezik.</p>`
    : `<p>Határidő: <strong>${escapeHtml(deadlineStr)}</strong>.</p>`;
  const bodyHtml = `
    <p>Szia ${escapeHtml(name) || 'GoFuvar szállító'}!</p>
    ${intro}
    <p>Amit kérünk a profilodon megadni (2 perc):</p>
    <ul>
      <li><strong>Adóazonosító jel</strong> (a 8-cal kezdődő, 10 jegyű szám az adókártyádról)</li>
      <li><strong>Születési dátum</strong></li>
      <li><strong>Lakcím</strong></li>
    </ul>
    ${consequence}
    <p style="font-size:13px;color:#6b7280">Az adatokat kizárólag a törvényi adatszolgáltatáshoz használjuk, és az adatkezelési tájékoztatónk szerint védjük. A fuvardíjad adózása ettől független — a platform nem von le semmit, csak jelent.</p>
  `;
  return sendEmail({
    to,
    subject: reminderNo >= 2
      ? 'Utolsó emlékeztető: adóazonosító jel megadása szükséges'
      : 'Adóazonosító jel megadása szükséges (jogszabályi kötelezettség)',
    html: wrapHtml({
      heading,
      bodyHtml,
      ctaText: 'Megadom a profilomon',
      ctaHref: `${getWebBase()}/profil`,
    }),
  });
}

/**
 * Admin-üzenet a felhasználónak (közvetlen VAGY körüzenet email-mása).
 * A body sortöréseit megőrizzük; a tartalom user-vezérelt szempontból az
 * ADMIN szövege, de az escape a biztonsági alapszabály miatt így is jár.
 */
/**
 * Alvó fiók: figyelmeztetés a közelgő automatikus törlésről.
 *
 * ⚠️ A FIGYELMEZTETÉS A SZABÁLY RÉSZE, nem udvariasság. Előzmény nélküli
 * törlésnél a felhasználó a fuvar-előzményét, az értékeléseit és a
 * referral-kódját veszítené el anélkül, hogy bármit tehetett volna ellene.
 * Egyetlen bejelentkezés visszaállítja az órát.
 */
async function sendDormantAccountWarningEmail({ to, name, deleteDate }) {
  const datum = deleteDate instanceof Date
    ? deleteDate.toLocaleDateString('hu-HU') : String(deleteDate || '');
  const bodyHtml = `
    <p>Szia ${escapeHtml(name) || 'GoFuvar felhasználó'}!</p>
    <p>Régen jártál nálunk — a fiókodba <strong>több mint 3 éve</strong> nem
       jelentkeztél be.</p>
    <p>Az adataidat nem őrizzük tovább a szükségesnél, ezért ha
       <strong>${escapeHtml(datum)}</strong>-ig nem lépsz be, a fiókodat és a
       hozzá tartozó személyes adatokat automatikusan töröljük.</p>
    <p><strong>Ha meg szeretnéd tartani, nincs teendőd azon kívül, hogy
       belépsz</strong> — ez önmagában visszaállítja az órát, és nem kapsz
       több ilyen levelet.</p>
    <p style="font-size:13px;color:#64748b">Ha nem szeretnéd megtartani, nem
       kell tenned semmit. A törlés után a fuvar-előzményed, az értékeléseid és
       az ajánlói kódod is megszűnik. A számlákra került adatokat a számviteli
       törvény alapján 8 évig akkor is meg kell őriznünk.</p>`;
  return sendEmail({
    to,
    subject: '⏳ A GoFuvar-fiókod hamarosan törlődik',
    html: wrapHtml({
      heading: '⏳ Régen jártál nálunk',
      bodyHtml,
      ctaText: 'Belépek, megtartom a fiókom',
      ctaHref: `${getWebBase()}/belepes`,
    }),
  });
}

async function sendAdminMessageEmail({ to, name, bodyText }) {
  const bodyHtml = `
    <p>Szia ${escapeHtml(name) || 'GoFuvar felhasználó'}!</p>
    <p>Üzeneted érkezett a GoFuvar csapatától:</p>
    <div style="background:#f8fafc;border-left:4px solid #1e40af;border-radius:8px;padding:14px 16px;margin:16px 0;white-space:pre-wrap">${escapeHtml(bodyText)}</div>
    <p style="font-size:13px;color:#6b7280">Az üzenetet a GoFuvar felületén, az „Üzenetek" oldalon is megtalálod.</p>
  `;
  return sendEmail({
    to,
    subject: 'Üzenet a GoFuvar csapatától',
    html: wrapHtml({
      heading: '📩 Üzenet a GoFuvar csapatától',
      bodyHtml,
      ctaText: 'Megnyitom az üzenetet',
      ctaHref: `${getWebBase()}/uzenetek`,
    }),
  });
}

module.exports = {
  __resetEmailAlertsForTests,
  // A wrapHtml exportálva, hogy a levél-váz viselkedése MÉRHETŐ legyen
  // (2026-08-12): a heading nélküli hívás korábban „undefined" címsort adott.
  wrapHtml,
  sendDormantAccountWarningEmail,
  sendEmail,
  cimzettiTajekoztatoBlokk,
  // ⚠️ EXPORTÁLVA (2026-08-11): a routes/-ban lévő inline levelek eddig NEM a
  // közös sablonon mentek, ezért hiányzott belőlük az adatkezelő megnevezése
  // és a tájékoztató linkje — pedig ezek egy része épp a CÍMZETTNEK megy,
  // akinek nincs fiókja és semmit nem fogadott el (GDPR 14. cikk).
  wrapHtml,
  // ⚠️ EXPORTÁLVA (2026-08-10, adatáramlási audit): a routes/-ban lévő
  // inline sendEmail-hívások eddig NEM escape-eltek — egy szállító a saját
  // NEVÉBE tett HTML-lel GoFuvar-arculatú, noreply@gofuvar.hu-ról érkező
  // levelet küldethetett a feladónak és a címzettnek.
  escapeHtml,
  sendBidReceivedEmail,
  sendLaneAlertEmail,
  sendBidAcceptedEmail,
  sendJobPaidEmail,
  sendFeeConfirmationEmail,
  sendFeePaymentFailedEmail,
  sendCibRiasztasEmail,
  cibRiasztasTartalom,
  bankiAdatsorHtml,
  sendBookingReceivedEmail,
  sendBookingConfirmedEmail,
  sendBookingPaidEmail,
  sendBookingRejectedEmail,
  sendCancellationEmail,
  sendRecipientTrackingEmail,
  sendRecipientPickupEmail,
  sendEmailVerificationEmail,
  sendPasswordResetEmail,
  sendTaxDataRequestEmail,
  sendAdminMessageEmail,
  sendPaymentDueEmail,
  isStub,
};
