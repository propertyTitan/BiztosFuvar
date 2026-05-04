// =====================================================================
//  SMS küldés — SeeMe.hu gateway integráció.
//
//  Alfanumerikus feladó: "GoFuvar"
//  API: https://seeme.hu/gateway
//
//  Fontos:
//    - 160 karakter = 1 SMS (GSM 7-bit)
//    - Ékezetes karakterek (ő,ű,á,é,stb.) → ékezettelenítve, hogy
//      ne csússzon 70 karakter/SMS-re (UCS-2 kódolás)
//    - Automatikus telefonszám normalizálás (06 → 36)
//
//  Env változók:
//    SEEME_API_KEY  — API kulcs (kötelező az éles küldéshez)
//
//  Ha SEEME_API_KEY nincs beállítva → STUB mód (csak logol).
// =====================================================================

const SEEME_GATEWAY_URL = 'https://seeme.hu/gateway';
const SEEME_API_KEY = 'zktq7fhqf0vji4hew2f66kcaovk9xh3ia163';

function isStub() {
  return !(process.env.SEEME_API_KEY || SEEME_API_KEY);
}

function getApiKey() {
  return process.env.SEEME_API_KEY || SEEME_API_KEY;
}

/**
 * Magyar ékezetes karakterek eltávolítása → GSM 7-bit kompatibilis.
 * Így 160 karakter = 1 SMS (nem 70 karakter UCS-2 módban).
 */
function removeAccents(str) {
  const map = {
    'á': 'a', 'Á': 'A',
    'é': 'e', 'É': 'E',
    'í': 'i', 'Í': 'I',
    'ó': 'o', 'Ó': 'O',
    'ö': 'o', 'Ö': 'O',
    'ő': 'o', 'Ő': 'O',
    'ú': 'u', 'Ú': 'U',
    'ü': 'u', 'Ü': 'U',
    'ű': 'u', 'Ű': 'U',
  };
  return str.replace(/[áÁéÉíÍóÓöÖőŐúÚüÜűŰ]/g, (ch) => map[ch] || ch);
}

/**
 * Telefonszám normalizálás a SeeMe formátumra.
 * Elfogad: +36301234567, 06301234567, 36301234567
 * Visszaad: 36301234567 (+ jel nélkül, országkóddal)
 */
function normalizePhone(phone) {
  let clean = phone.replace(/[\s\-()]/g, '');
  if (clean.startsWith('+')) clean = clean.slice(1);
  if (clean.startsWith('06')) clean = '36' + clean.slice(2);
  return clean;
}

/**
 * SMS küldése a SeeMe.hu gateway-en keresztül.
 *
 * @param {string} to — telefonszám
 * @param {string} message — SMS szöveg (ékezeteket automatikusan eltávolítjuk)
 * @returns {Promise<{ok: boolean, stub?: boolean, result?: string}>}
 */
async function sendSms(to, message) {
  if (!to || !message) {
    console.warn('[sms] hiányzó paraméter:', { to: !!to, message: !!message });
    return { ok: false };
  }

  const phone = normalizePhone(to);
  const cleanMessage = removeAccents(message);
  const smsCount = Math.ceil(cleanMessage.length / 160);

  if (isStub()) {
    console.log(`[sms-stub] GoFuvar → ${phone}: (${cleanMessage.length} kar, ${smsCount} SMS) ${cleanMessage}`);
    return { ok: true, stub: true };
  }

  try {
    const params = new URLSearchParams({
      key: getApiKey(),
      message: cleanMessage,
      number: phone,
      from: 'GoFuvar',
      callback: '0',
    });

    const res = await fetch(`${SEEME_GATEWAY_URL}?${params.toString()}`);
    const text = await res.text();

    // SeeMe válasz: "OK <id>" ha sikeres, "ERR <code>" ha hiba
    if (text.startsWith('OK')) {
      console.log(`[sms] küldve: ${phone} (${cleanMessage.length} kar, ${smsCount} SMS) id=${text}`);
      return { ok: true, result: text.trim() };
    }

    console.warn(`[sms] hiba: ${phone} → ${text}`);
    return { ok: false, error: text };
  } catch (err) {
    console.error('[sms] küldés sikertelen:', err.message);
    return { ok: false, error: err.message };
  }
}

module.exports = { sendSms, removeAccents, normalizePhone, isStub };
