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

const { maskEmail } = require('../utils/mask');

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

/**
 * Nyers küldés Resend API-n keresztül (vagy STUB mode-ban csak log).
 * Sose dob hibát — ha el is akad, csendben naplóz és null-al tér vissza,
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
  try {
    const res = await fetch(RESEND_API_URL, {
      method: 'POST',
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
      console.error('[email] Resend hiba:', res.status, body.slice(0, 300));
      return null;
    }
    const json = await res.json();
    return { stub: false, id: json.id || null };
  } catch (err) {
    console.error('[email] hálózati hiba:', err.message);
    return null;
  }
}

// ---------- HTML email sablon (egyszerű wrapper) ----------

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
              <h1 style="margin:0 0 16px;font-size:20px;line-height:1.3;color:#0f172a">${heading}</h1>
              <div style="font-size:14px;line-height:1.6;color:#334155">${bodyHtml}</div>
              ${cta}
            </td>
          </tr>
          <tr>
            <td style="padding:20px 32px;border-top:1px solid #e2e8f0;background:#f8fafc;font-size:12px;color:#64748b">
              Ezt az üzenetet automatikusan küldte a GoFuvar. Ha nem te végezted ezt a műveletet, kérjük vedd fel velünk a kapcsolatot.
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
 * Új licit érkezett a feladó egyik fuvarára.
 */
async function sendBidReceivedEmail({ to, shipperName, jobTitle, jobId, carrierName, amountHuf }) {
  const heading = '🎯 Új licit a fuvarodra!';
  const bodyHtml = `
    <p>Szia ${escapeHtml(shipperName) || 'GoFuvar felhasználó'}!</p>
    <p><strong>${escapeHtml(carrierName) || 'Egy sofőr'}</strong> ajánlatot tett a(z) <strong>"${escapeHtml(jobTitle)}"</strong> fuvarodra.</p>
    <p style="font-size:24px;font-weight:800;color:#1e40af;margin:20px 0">${formatHuf(amountHuf)} Ft</p>
    <p>Nyisd meg a részleteket, hogy elfogadhasd vagy összehasonlíthasd más ajánlatokkal.</p>
  `;
  return sendEmail({
    to,
    subject: `Új licit: ${formatHuf(amountHuf)} Ft – ${jobTitle}`,
    html: wrapHtml({
      heading,
      bodyHtml,
      ctaText: 'Ajánlatok megtekintése',
      ctaHref: `${getWebBase()}/dashboard/fuvar/${jobId}`,
    }),
  });
}

/**
 * Útvonal-figyelő találat: új fuvar a sofőr által figyelt útvonalon.
 */
async function sendLaneAlertEmail({ to, carrierName, jobTitle, jobId, routeLabel, priceHuf }) {
  const heading = '🎯 Új fuvar a figyelt útvonaladon!';
  const bodyHtml = `
    <p>Szia ${escapeHtml(carrierName) || 'GoFuvar felhasználó'}!</p>
    <p>Új licitálható fuvar került ki, ami illeszkedik az egyik beállított útvonal-figyelődre:</p>
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
 * A sofőr licitjét elfogadta a feladó.
 */
async function sendBidAcceptedEmail({ to, carrierName, jobTitle, jobId, amountHuf }) {
  const heading = '🎉 Elfogadták a licitedet!';
  const bodyHtml = `
    <p>Szia ${escapeHtml(carrierName) || 'GoFuvar felhasználó'}!</p>
    <p>Nagyszerű hírek — a(z) <strong>"${escapeHtml(jobTitle)}"</strong> fuvar feladója elfogadta az ajánlatodat!</p>
    <p style="font-size:24px;font-weight:800;color:#16a34a;margin:20px 0">${formatHuf(amountHuf)} Ft</p>
    <p>A teljes összeget <strong>készpénzben</strong> kapod a feladótól. Amint a feladó megfizeti a kapcsolatfelvételi díjat, megkapjátok egymás elérhetőségét és elindulhatsz. A fuvart a felvételi fotóval és a 6 jegyű átvételi kóddal tudod majd lezárni.</p>
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
 * A feladó kifizette a licites fuvart → a sofőr kap értesítést.
 */
async function sendJobPaidEmail({ to, carrierName, jobTitle, jobId, amountHuf, shipperName }) {
  const heading = '🤝 Indulhat a fuvar!';
  const bodyHtml = `
    <p>Szia ${escapeHtml(carrierName) || 'GoFuvar felhasználó'}!</p>
    <p><strong>${escapeHtml(shipperName) || 'A feladó'}</strong> kifizette a kapcsolatfelvételi díjat a(z) <strong>"${escapeHtml(jobTitle)}"</strong> fuvarhoz — mostantól látjátok egymás elérhetőségét.</p>
    <p style="font-size:24px;font-weight:800;color:#16a34a;margin:20px 0">${formatHuf(amountHuf)} Ft</p>
    <p>Indulhatsz! A fuvardíjat <strong>készpénzben</strong> kapod a feladótól. A fuvart a felvételi fotóval és a 6 jegyű átvételi kóddal zárod le.</p>
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
 * @param {number} [p.cashHuf] — a sofőrnek készpénzben járó fuvardíj
 * @param {string} [p.paidAtIso] — a fizetés időpontja (ISO string)
 * @param {string} [p.detailsPath] — a fuvar/foglalás oldala (pl. /dashboard/fuvar/<id>)
 */
async function sendFeeConfirmationEmail({
  to, shipperName, jobTitle, feeHuf, cashHuf, paidAtIso, detailsPath,
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
    <p>A szolgáltatás (a sofőr kapcsolatfelvételi adatainak átadása és a fuvar-folyamat
    elindítása) a fizetéssel <strong>teljesült</strong> — a sofőr elérhetőségét a fuvar
    oldalán találod.</p>
    <div style="background:#f8fafc;border:1px solid #e2e8f0;border-radius:10px;padding:14px 16px;margin:16px 0;font-size:13px;line-height:1.6">
      <strong>A fizetéskor tett nyilatkozatod:</strong><br />
      „Kérem a szolgáltatás (kapcsolatfelvételi adatok átadása) azonnali teljesítését,
      és tudomásul veszem, hogy a teljesítés után elállási jogomat elvesztem
      (45/2014. Korm. rendelet 29. § (1) a)). A díj nem visszatérítendő; ha a fuvar a
      sofőr hibájából hiúsul meg, díjmentesen választhatok másik sofőrt ugyanerre a fuvarra."
    </div>
    ${cashHuf ? `<p>💵 Emlékeztető: a fuvardíjat (<strong>${formatHuf(cashHuf)} Ft</strong>)
    <strong>készpénzben</strong> fizeted közvetlenül a sofőrnek — a GoFuvar a fuvardíjat
    nem kezeli.</p>` : ''}
    <p style="font-size:13px;color:#666">Ha a sofőr visszalép vagy nem elérhető, a fuvar
    oldalán díjmentesen választhatsz másik sofőrt ugyanerre a fuvarra — a díj másik
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

/**
 * Új foglalás érkezett a sofőr egyik útvonalára.
 */
async function sendBookingReceivedEmail({ to, carrierName, routeTitle, routeId, shipperName, priceHuf }) {
  const heading = '📦 Új foglalás érkezett!';
  const bodyHtml = `
    <p>Szia ${escapeHtml(carrierName) || 'GoFuvar felhasználó'}!</p>
    <p><strong>${escapeHtml(shipperName) || 'Egy feladó'}</strong> foglalt helyet a(z) <strong>"${escapeHtml(routeTitle)}"</strong> útvonaladra.</p>
    <p style="font-size:24px;font-weight:800;color:#1e40af;margin:20px 0">${formatHuf(priceHuf)} Ft</p>
    <p>Erősítsd meg a foglalást — a feladó a kapcsolatfelvételi díj megfizetése után látja az elérhetőségedet, a fuvardíjat készpénzben kapod tőle.</p>
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
 * A sofőr megerősítette a foglalást → feladó tud fizetni.
 */
async function sendBookingConfirmedEmail({ to, shipperName, routeTitle, bookingId, carrierName, priceHuf }) {
  const heading = '✅ A sofőr megerősítette a foglalásod!';
  const bodyHtml = `
    <p>Szia ${escapeHtml(shipperName) || 'GoFuvar felhasználó'}!</p>
    <p><strong>${escapeHtml(carrierName) || 'A sofőr'}</strong> elfogadta a foglalásodat a(z) <strong>"${escapeHtml(routeTitle)}"</strong> útvonalon.</p>
    <p style="font-size:24px;font-weight:800;color:#16a34a;margin:20px 0">${formatHuf(priceHuf)} Ft</p>
    <p>Most tudod megfizetni a kapcsolatfelvételi díjat — utána megkapod a sofőr elérhetőségét, a fuvardíjat pedig készpénzben adod át neki. A foglalásod a "Foglalásaim" menüpontban érhető el.</p>
  `;
  return sendEmail({
    to,
    subject: `Megerősítve: ${routeTitle}`,
    html: wrapHtml({
      heading,
      bodyHtml,
      ctaText: 'Fizetés most',
      ctaHref: `${getWebBase()}/dashboard/foglalasaim`,
    }),
  });
}

/**
 * A feladó kifizette a fix áras foglalást → sofőr kap értesítést.
 */
async function sendBookingPaidEmail({ to, carrierName, routeTitle, bookingId, priceHuf, shipperName }) {
  const heading = '🤝 Indulhat a foglalás!';
  const bodyHtml = `
    <p>Szia ${escapeHtml(carrierName) || 'GoFuvar felhasználó'}!</p>
    <p><strong>${escapeHtml(shipperName) || 'A feladó'}</strong> kifizette a kapcsolatfelvételi díjat a(z) <strong>"${escapeHtml(routeTitle)}"</strong> útvonaladra szóló foglaláshoz.</p>
    <p style="font-size:24px;font-weight:800;color:#16a34a;margin:20px 0">${formatHuf(priceHuf)} Ft</p>
    <p>A fuvardíjat <strong>készpénzben</strong> kapod a feladótól a csomag átadásakor/kézbesítésekor.</p>
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
  const heading = 'A sofőr elutasította a foglalásod';
  const bodyHtml = `
    <p>Szia ${escapeHtml(shipperName) || 'GoFuvar felhasználó'}!</p>
    <p>Sajnáljuk, de a sofőr elutasította a foglalásodat a(z) <strong>"${escapeHtml(routeTitle)}"</strong> útvonalon. Nem volt pénzmozgás — semmit nem kell tenned.</p>
    <p>Ne csüggedj! Nézz körül az "Útba eső sofőrök" menüpontban — rengeteg más útvonal közül választhatsz.</p>
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
  const whoCancelled = cancelledByRole === 'shipper' ? 'a feladó' : 'a sofőr';
  const heading = '❌ Fuvar lemondva';
  let bodyHtml = `
    <p>Szia ${escapeHtml(recipientName) || 'GoFuvar felhasználó'}!</p>
    <p>Az alábbi fuvart <strong>${whoCancelled}</strong> lemondta:
    <strong>"${escapeHtml(jobTitle)}"</strong>.</p>
  `;
  if (recipientIsShipper) {
    bodyHtml += `
      <p>Pénzmozgás nem történt a lemondással: a fuvardíj készpénzben járt volna a sofőrnek, így nincs mit visszatéríteni. Ha már fizettél kapcsolatfelvételi díjat, az a fuvarra érvényes marad — a fuvar oldalán díjmentesen választhatsz másik sofőrt a korábbi ajánlatok közül.</p>
    `;
  }
  if (!recipientIsShipper) {
    bodyHtml += `
      <p>Az útvonaladon/licites fuvaron lévő foglalás visszavonásra került. Nincs további teendőd.</p>
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
        <div style="background:#f0fdf4;border:2px solid #16a34a;border-radius:12px;padding:20px;text-align:center;margin:20px 0">
          <div style="font-size:13px;color:#666;margin-bottom:8px">Átvételi kód</div>
          <div style="font-size:36px;font-weight:800;letter-spacing:6px;font-family:monospace">${escapeHtml(deliveryCode)}</div>
          <div style="font-size:12px;color:#666;margin-top:8px">Ezt a kódot add meg a sofőrnek amikor megérkezik</div>
        </div>
        <a href="${escapeHtml(trackingUrl)}" style="display:block;text-align:center;background:#1e40af;color:#fff;padding:14px;border-radius:8px;text-decoration:none;font-weight:700;font-size:16px">
          📍 Fuvar követése élőben
        </a>
        <p style="font-size:12px;color:#999;margin-top:20px;text-align:center">
          Ezen az oldalon látod a sofőr pozícióját és a becsült érkezési időt.
          Nem kell regisztrálnod a GoFuvar-ra.
        </p>
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
    fontos értesítéseket küldeni (új licit, fizetés, lejáró jogosítvány, stb.).</p>
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

module.exports = {
  sendEmail,
  sendBidReceivedEmail,
  sendLaneAlertEmail,
  sendBidAcceptedEmail,
  sendJobPaidEmail,
  sendFeeConfirmationEmail,
  sendBookingReceivedEmail,
  sendBookingConfirmedEmail,
  sendBookingPaidEmail,
  sendBookingRejectedEmail,
  sendCancellationEmail,
  sendRecipientTrackingEmail,
  sendEmailVerificationEmail,
  sendPasswordResetEmail,
  isStub,
};
