// =====================================================================
//  SMS küldés — SeeMe.hu gateway integráció.
//
//  Alfanumerikus feladó: "GoFuvar"
//  API: https://seeme.hu/gateway
//
//  Fontos:
//    - ÉKEZETES küldés (2026-07-13, user-döntés): a szöveg ékezetekkel
//      megy ki — igényesebb, cserébe UCS-2 kódolás: 70 kar = 1 szegmens,
//      többrészesnél 67 kar/szegmens. A fuvaronkénti EGYETLEN SMS-nél ez
//      tipikusan 2 szegmens (~2× díj) — tudatos döntés.
//      A removeAccents megmaradt exportként, ha később spórolni kell.
//    - Automatikus telefonszám normalizálás (06 → 36)
//
//  Env változók:
//    SEEME_API_KEY  — API kulcs (kötelező az éles küldéshez)
//
//  Ha SEEME_API_KEY nincs beállítva → STUB mód (csak logol).
// =====================================================================

const { maskPhone } = require('../utils/mask');

const SEEME_GATEWAY_URL = 'https://seeme.hu/gateway';
// A kulcs KIZÁRÓLAG env-ből jöhet — korábban be volt égetve a forrásba,
// emiatt a régi kulcsot a SeeMe felületén rotálni kellett/kell.
function isStub() {
  return !process.env.SEEME_API_KEY;
}

function getApiKey() {
  return process.env.SEEME_API_KEY;
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
 * SMS-szegmensek száma. Nem-ASCII (ékezetes) tartalomnál UCS-2:
 * 70 kar = 1 rész, többrészesnél 67 kar/rész; tiszta ASCII-nál GSM-7:
 * 160 / többrészesnél 153.
 */
function smsSegments(text) {
  const ucs2 = /[^\x20-\x7E]/.test(text);
  const single = ucs2 ? 70 : 160;
  const multi = ucs2 ? 67 : 153;
  return text.length <= single ? 1 : Math.ceil(text.length / multi);
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
  // Ékezetes küldés — a szöveget NEM alakítjuk át (lásd fejléc-komment)
  const cleanMessage = message;
  const smsCount = smsSegments(cleanMessage);

  if (isStub()) {
    // FONTOS: a szöveget NEM logoljuk — tartalmazhatja az átvételi kódot.
    console.log(`[sms-stub] GoFuvar → ${maskPhone(phone)} (${cleanMessage.length} kar, ${smsCount} SMS)`);
    return { ok: true, stub: true };
  }

  try {
    // SeeMe gateway paraméterek (https://seeme.hu/tudastar/reszletek/
    // sms-gateway-parameterek): key + number + message (UTF-8) kötelező.
    // - 'sender' feladóazonosítót CSAK akkor küldünk, ha az adminban
    //   jóváhagyott (különben code 9 elutasítás) → env-ből kapcsolható.
    // - 'callback'-et NEM küldünk (státuszkód-listát vár; a korábbi
    //   callback=0 érvénytelen volt → code 15, a küldés eldobva!).
    const params = new URLSearchParams({
      key: getApiKey(),
      message: cleanMessage,
      number: phone,
    });
    if (process.env.SEEME_SENDER) params.set('sender', process.env.SEEME_SENDER);

    const res = await fetch(`${SEEME_GATEWAY_URL}?${params.toString()}`);
    const text = await res.text();

    // SeeMe válasz query-string formában:
    //   result=OK&price=...&code=0  |  result=ERR&code=<n>&message=<miért>
    const parsed = new URLSearchParams(text);
    if (parsed.get('result') === 'OK' || parsed.get('code') === '0') {
      console.log(`[sms] küldve: ${maskPhone(phone)} (${cleanMessage.length} kar, ${smsCount} szegmens, ár: ${parsed.get('price') || '?'})`);
      return { ok: true, result: text.trim() };
    }

    console.warn(`[sms] SeeMe elutasítás: ${maskPhone(phone)} → code=${parsed.get('code')} ${parsed.get('message') || text}`);
    return { ok: false, error: text };
  } catch (err) {
    console.error('[sms] küldés sikertelen:', err.message);
    return { ok: false, error: err.message };
  }
}

module.exports = { sendSms, removeAccents, normalizePhone, isStub, smsSegments };
