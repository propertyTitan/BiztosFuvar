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
 * SMS-hiba riasztás a Sentrybe (ha be van kötve). A néma SMS-kiesés a
 * legalattomosabb üzemzavar: a küldés fire-and-forget, a user semmit nem
 * lát belőle. Kiemelt eset a SeeMe code=13 — az azt jelenti, hogy a
 * Railway KIMENŐ IP-JE ELFORDULT, és nincs rajta a SeeMe engedélyezett
 * IP-listáján. ⚠️ 2026-08-30 (user-döntés): a SeeMe IP-szűrőjébe a TELJES
 * tartomány (0.0.0.0–255.255.255.255) felvéve — az API-kulcs a valódi
 * védelem (mint minden normális SMS-gateway-nél) —, tehát a code=13
 * osztálynak MEG KELLETT szűnnie. Ha mégis code=13 jön, a tartomány-szabály
 * tűnt el a SeeMe adminból: Gateway hozzáférés → IP-tartomány újrafelvétele.
 */
function reportSmsFailure(code, message, phone) {
  if (!process.env.SENTRY_DSN) return;
  try {
    const Sentry = require('@sentry/node');
    const title = String(code) === '13'
      ? 'SMS-küldés ÁLL: a Railway kimenő IP nincs engedélyezve a SeeMe-nél (code=13) — SeeMe admin: új IP hozzáadása!'
      : `SMS-küldés elutasítva (SeeMe code=${code || '?'})`;
    Sentry.captureMessage(title, {
      level: 'error',
      tags: { seeme_code: String(code || 'ismeretlen') },
      extra: { seeme_message: message, phone: maskPhone(phone) },
    });
  } catch (_) {
    // A riasztás hibája sosem érintheti a fő folyamatot.
  }
}

// ── Újraküldési sor + üzemeltetői e-mail riasztás (2026-08-30) ──────────
//
// A két TAPASZTALT éles hibamód (code=13 IP-allowlist, code=7 egyenleg)
// eddig VÉGLEGES veszteség volt: a Sentry riasztott, de az SMS elveszett —
// a hiba elhárítása után sem ment ki. 2026-08-20 és 08-30 között élesben
// pontosan ez történt: 10 napig egyetlen címzett sem kapta meg a kódot.
// Mostantól a sikertelen (újrapróbálható) küldés DB-sorba kerül, és a
// smsRetry.js köre 48 órán át újrapróbálja. A Sentry mellé közvetlen
// e-mail is megy az üzemeltetőnek — a Sentryt nem nézi naponta, a leveleit
// igen. Az e-mail hibamódonként legfeljebb 6 óránként ismétlődik.

// Ezekre a hibákra van értelme újrapróbálkozni: a 13 (IP) és a 7 (egyenleg)
// üzemeltetői beavatkozással megjavul, az üzenet maga hibátlan. Minden más
// kód (rossz szám, tiltott feladó…) újraküldve is ugyanúgy elhasalna.
const RETRYABLE_CODES = ['7', '13'];
const ALERT_THROTTLE_MS = 6 * 60 * 60 * 1000;
const lastAlertAt = new Map();

/** Teszt-horog: a throttle-állapot nullázása (másra ne használd). */
function resetSmsAlertThrottle() {
  lastAlertAt.clear();
}

async function queueForRetry(phone, message, reason) {
  try {
    const db = require('../db');
    await db.query(
      'INSERT INTO sms_retry_queue (phone, message, last_error) VALUES ($1, $2, $3)',
      [phone, message, String(reason || 'ismeretlen').slice(0, 300)],
    );
    console.log(`[sms-retry] sorba téve: ${maskPhone(phone)} (${reason})`);
    return true;
  } catch (err) {
    // A sorba tétel hibája nem ronthatja tovább a küldési utat.
    console.error('[sms-retry] sorba tétel sikertelen:', err.message);
    return false;
  }
}

async function alertOpsByEmail(code) {
  const kod = String(code);
  const most = Date.now();
  const utolso = lastAlertAt.get(kod) || 0;
  if (most - utolso < ALERT_THROTTLE_MS) return;
  lastAlertAt.set(kod, most);

  const teendo = kod === '13'
    ? 'A SeeMe elutasítja a Railway kimenő IP-jét. A 2026-08-30-i döntés óta a teljes '
      + 'IP-tartomány (0.0.0.0–255.255.255.255) engedélyezve van — ha mégis code=13 jön, '
      + 'a tartomány-szabály eltűnt: SeeMe admin → SMS Gateway → IP-szűrés → a tartomány újrafelvétele.'
    : kod === '7'
      ? 'Elfogyott a SeeMe-egyenleg. Teendő: egyenleg-feltöltés a SeeMe adminban.'
      : `A SeeMe code=${kod} hibával utasítja el a küldést — részletek a Railway logban ([sms] sorok).`;

  try {
    await require('./email').sendEmail({
      to: process.env.SMS_ALERT_EMAIL || 'info@gofuvar.hu',
      subject: `⚠️ GoFuvar: SMS-küldés akadozik (SeeMe code=${kod})`,
      html: `<p>A címzetti SMS-küldés a SeeMe-nél elakad (code=${kod}).</p>`
        + `<p><strong>${teendo}</strong></p>`
        + '<p>Az érintett SMS-ek NEM vesznek el: a rendszer 48 órán át újrapróbálja őket, '
        + 'a hiba elhárítása után maguktól kimennek. Ez a riasztás hibamódonként '
        + 'legfeljebb 6 óránként ismétlődik.</p>',
    });
  } catch (err) {
    // A riasztás hibája sosem érintheti a küldési utat.
    console.error('[sms-retry] riasztó e-mail sikertelen:', err.message);
  }
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
 * @param {object} [opts]
 * @param {boolean} [opts.queueOnFailure=true] — újrapróbálható hibánál a
 *        sorba tétel. Az újraküldő kör (smsRetry.js) FALSE-szal hív, hogy a
 *        sikertelen újrapróba ne duplikálja a saját sorát.
 * @returns {Promise<{ok: boolean, stub?: boolean, result?: string}>}
 */
async function sendSms(to, message, opts = {}) {
  const { queueOnFailure = true } = opts;
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

    const hibaKod = parsed.get('code');
    console.warn(`[sms] SeeMe elutasítás: ${maskPhone(phone)} → code=${hibaKod} ${parsed.get('message') || text}`);
    reportSmsFailure(hibaKod, parsed.get('message') || text, phone);
    if (queueOnFailure && RETRYABLE_CODES.includes(String(hibaKod))) {
      await queueForRetry(phone, cleanMessage, `code=${hibaKod}`);
      await alertOpsByEmail(hibaKod);
    }
    return { ok: false, error: text };
  } catch (err) {
    console.error('[sms] küldés sikertelen:', err.message);
    // Hálózati/váratlan hiba is riasztást érdemel — az SMS némán esne ki.
    if (process.env.SENTRY_DSN) {
      try { require('@sentry/node').captureException(err); } catch (_) { /* no-op */ }
    }
    // Hálózati hiba jellemzően átmeneti → az üzenet újrapróbálást érdemel.
    // E-mail riasztás itt nincs (a Sentry captureException már jelez).
    if (queueOnFailure) {
      await queueForRetry(phone, cleanMessage, `halozat: ${err.message}`);
    }
    return { ok: false, error: err.message };
  }
}

module.exports = {
  sendSms, removeAccents, normalizePhone, isStub, smsSegments,
  RETRYABLE_CODES, resetSmsAlertThrottle,
};
