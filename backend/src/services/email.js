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
    console.warn('[email] hiányos adat:', { to, subject });
    return null;
  }
  if (isStub()) {
    console.log('[email STUB]', { to, subject });
    console.log('[email STUB] — body preview:', html.replace(/<[^>]+>/g, '').slice(0, 200));
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
              <div style="font-size:13px;opacity:0.85;margin-top:4px">Bizalom. Fotó. Kód. Letét.</div>
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
    <p>Szia ${shipperName || 'GoFuvar felhasználó'}!</p>
    <p><strong>${carrierName || 'Egy sofőr'}</strong> ajánlatot tett a(z) <strong>"${jobTitle}"</strong> fuvarodra.</p>
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
 * A sofőr licitjét elfogadta a feladó.
 */
async function sendBidAcceptedEmail({ to, carrierName, jobTitle, jobId, amountHuf }) {
  const heading = '🎉 Elfogadták a licitedet!';
  const bodyHtml = `
    <p>Szia ${carrierName || 'GoFuvar felhasználó'}!</p>
    <p>Nagyszerű hírek — a(z) <strong>"${jobTitle}"</strong> fuvar feladója elfogadta az ajánlatodat!</p>
    <p style="font-size:24px;font-weight:800;color:#16a34a;margin:20px 0">${formatHuf(amountHuf)} Ft</p>
    <p>Amint a feladó kifizeti a fuvart (Barion letétbe), elindulhatsz. A fuvart a mobilapplikációban tudod majd lezárni a felvételi fotóval és a 6 jegyű átvételi kóddal.</p>
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
  const heading = '💰 Kifizették a fuvarodat!';
  const bodyHtml = `
    <p>Szia ${carrierName || 'GoFuvar felhasználó'}!</p>
    <p><strong>${shipperName || 'A feladó'}</strong> kifizette a(z) <strong>"${jobTitle}"</strong> fuvart — a fuvardíj a Barion letétben van.</p>
    <p style="font-size:24px;font-weight:800;color:#16a34a;margin:20px 0">${formatHuf(amountHuf)} Ft</p>
    <p>Indulhatsz! A Proof of Delivery után (pickup + dropoff fotó, 6 jegyű átvételi kód) a sofőri rész (90%) automatikusan a tiéd lesz.</p>
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
 * Új foglalás érkezett a sofőr egyik útvonalára.
 */
async function sendBookingReceivedEmail({ to, carrierName, routeTitle, routeId, shipperName, priceHuf }) {
  const heading = '📦 Új foglalás érkezett!';
  const bodyHtml = `
    <p>Szia ${carrierName || 'GoFuvar felhasználó'}!</p>
    <p><strong>${shipperName || 'Egy feladó'}</strong> foglalt helyet a(z) <strong>"${routeTitle}"</strong> útvonaladra.</p>
    <p style="font-size:24px;font-weight:800;color:#1e40af;margin:20px 0">${formatHuf(priceHuf)} Ft</p>
    <p>Erősítsd meg a foglalást, hogy a feladó kifizethesse a fuvardíjat.</p>
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
    <p>Szia ${shipperName || 'GoFuvar felhasználó'}!</p>
    <p><strong>${carrierName || 'A sofőr'}</strong> elfogadta a foglalásodat a(z) <strong>"${routeTitle}"</strong> útvonalon.</p>
    <p style="font-size:24px;font-weight:800;color:#16a34a;margin:20px 0">${formatHuf(priceHuf)} Ft</p>
    <p>Most tudod kifizetni a fuvardíjat a Barion letétbe. A foglalásod a "Foglalásaim" menüpontban érhető el.</p>
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
  const heading = '💰 Kifizetett foglalás!';
  const bodyHtml = `
    <p>Szia ${carrierName || 'GoFuvar felhasználó'}!</p>
    <p><strong>${shipperName || 'A feladó'}</strong> kifizette a foglalását a(z) <strong>"${routeTitle}"</strong> útvonaladon.</p>
    <p style="font-size:24px;font-weight:800;color:#16a34a;margin:20px 0">${formatHuf(priceHuf)} Ft</p>
    <p>A fuvardíj a Barion letétben van. A csomag átadása után a sofőri rész automatikusan a tiéd lesz.</p>
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
    <p>Szia ${shipperName || 'GoFuvar felhasználó'}!</p>
    <p>Sajnáljuk, de a sofőr elutasította a foglalásodat a(z) <strong>"${routeTitle}"</strong> útvonalon. Nem volt pénzmozgás — semmit nem kell tenned.</p>
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
    <p>Szia ${recipientName || 'GoFuvar felhasználó'}!</p>
    <p>Az alábbi fuvart <strong>${whoCancelled}</strong> lemondta:
    <strong>"${jobTitle}"</strong>.</p>
  `;
  if (recipientIsShipper && refundHuf > 0) {
    bodyHtml += `
      <p>A Barion letétből <strong>${formatHuf(refundHuf)} Ft</strong> visszatérül a számládra
      a következő napokban.</p>
    `;
    if (feeHuf > 0) {
      bodyHtml += `
        <p class="muted">Lemondási díj: ${formatHuf(feeHuf)} Ft (10%, max 1000 Ft) – ez a szabályzatunk szerinti díj, amit levontunk a visszatérítésből.</p>
      `;
    }
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

module.exports = {
  sendEmail,
  sendBidReceivedEmail,
  sendBidAcceptedEmail,
  sendJobPaidEmail,
  sendBookingReceivedEmail,
  sendBookingConfirmedEmail,
  sendBookingPaidEmail,
  sendBookingRejectedEmail,
  sendCancellationEmail,
  isStub,
};
