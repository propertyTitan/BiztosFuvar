// =====================================================================
//  SMS küldés — TargetSMS.hu integráció.
//
//  Alfanumerikus feladó: "GoFuvar" (nem telefonszám jelenik meg).
//  API docs: https://targetsms.hu/api-dokumentacio
//
//  Env változók:
//    TARGETSMS_API_KEY    — API kulcs a targetsms.hu-ról
//    TARGETSMS_SENDER     — feladó név (alap: "GoFuvar")
//
//  Ha TARGETSMS_API_KEY nincs beállítva → STUB mód (csak logol).
// =====================================================================

const TARGETSMS_API_URL = 'https://api.targetsms.hu/http/SendSms';
const DEFAULT_SENDER = 'GoFuvar';

function isStub() {
  return !process.env.TARGETSMS_API_KEY;
}

/**
 * SMS küldése a TargetSMS.hu API-n keresztül.
 *
 * @param {string} to — telefonszám (pl. "+36301234567" vagy "06301234567")
 * @param {string} message — SMS szöveg (max ~640 karakter, 4 SMS-ig összefűzi)
 * @returns {Promise<{ok: boolean, stub?: boolean, messageId?: string}>}
 */
async function sendSms(to, message) {
  if (!to || !message) {
    console.warn('[sms] hiányzó paraméter:', { to: !!to, message: !!message });
    return { ok: false };
  }

  // Telefonszám normalizálás: 06 → +36
  let phone = to.replace(/[\s\-()]/g, '');
  if (phone.startsWith('06')) {
    phone = '+36' + phone.slice(2);
  }
  if (!phone.startsWith('+')) {
    phone = '+' + phone;
  }

  const sender = process.env.TARGETSMS_SENDER || DEFAULT_SENDER;

  if (isStub()) {
    console.log(`[sms-stub] ${sender} → ${phone}: ${message}`);
    return { ok: true, stub: true };
  }

  try {
    const params = new URLSearchParams({
      api_key: process.env.TARGETSMS_API_KEY,
      sender,
      to: phone,
      message,
      type: 'sms',
    });

    const res = await fetch(`${TARGETSMS_API_URL}?${params.toString()}`);
    const text = await res.text();

    if (res.ok && !text.includes('ERROR')) {
      console.log(`[sms] küldve: ${phone} (${message.length} kar)`);
      return { ok: true, messageId: text.trim() };
    }

    console.warn(`[sms] hiba: ${phone} → ${text}`);
    return { ok: false, error: text };
  } catch (err) {
    console.error('[sms] küldés sikertelen:', err.message);
    return { ok: false, error: err.message };
  }
}

module.exports = { sendSms, isStub };
