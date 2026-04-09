// Google Gemini API integráció – fotó "szemrevételezés" és leírás-ellenőrzés.
const { GoogleGenerativeAI } = require('@google/generative-ai');

let client = null;
function getClient() {
  if (!process.env.GEMINI_API_KEY) return null;
  if (!client) client = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
  return client;
}

function getModel() {
  const c = getClient();
  if (!c) return null;
  return c.getGenerativeModel({
    model: process.env.GEMINI_MODEL || 'gemini-1.5-flash',
  });
}

/**
 * Megpróbálja JSON-ként parse-olni a Gemini válaszát (akár ```json blokkból).
 */
function safeParseJson(text) {
  if (!text) return null;
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  const raw = fenced ? fenced[1] : text;
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

/**
 * Áru-felismerés egy feltöltött fotón.
 * @param {Buffer} imageBuffer – a fotó nyers bájtjai
 * @param {string} mimeType    – pl. "image/jpeg"
 * @param {('pickup'|'dropoff'|'damage'|'document')} kind
 * @returns {Promise<{has_cargo: boolean, confidence: number, notes: string, raw: any}>}
 */
async function analyzeCargoPhoto(imageBuffer, mimeType, kind = 'pickup') {
  const model = getModel();
  if (!model) {
    // Fejlesztői/offline mód: stub válasz, hogy a workflow tesztelhető legyen.
    return {
      has_cargo: true,
      confidence: 0.0,
      notes: 'Gemini API kulcs nincs beállítva – stub válasz.',
      raw: null,
    };
  }

  const prompt = `Te egy logisztikai minőségellenőr vagy a GoFuvar platformon.
A kép típusa: "${kind}" (pickup = felvétel, dropoff = lerakodás, damage = sérülés).

Elemezd a képet és válaszolj SZIGORÚAN JSON formátumban a következő mezőkkel:
{
  "has_cargo": boolean,         // látható-e szállítandó áru/csomag a képen
  "confidence": number,         // 0.0 - 1.0
  "cargo_type": string|null,    // pl. "doboz", "raklap", "bútor"
  "visible_damage": boolean,    // van-e látható sérülés
  "notes": string               // rövid magyar nyelvű megjegyzés
}
Csak a JSON-t add vissza, semmi mást.`;

  const result = await model.generateContent([
    { text: prompt },
    { inlineData: { data: imageBuffer.toString('base64'), mimeType } },
  ]);

  const text = result.response.text();
  const parsed = safeParseJson(text) || {};

  return {
    has_cargo: parsed.has_cargo === true,
    confidence: typeof parsed.confidence === 'number' ? parsed.confidence : 0,
    notes: parsed.notes || '',
    raw: parsed && Object.keys(parsed).length ? parsed : { text },
  };
}

/**
 * Hirdetés-leírás ellenőrzése (pl. tilos / félrevezető tartalom kiszűrése).
 */
async function reviewJobDescription(title, description) {
  const model = getModel();
  if (!model) {
    return { ok: true, notes: 'Gemini API kulcs nincs beállítva – stub.' };
  }
  const prompt = `Egy magyar fuvar-hirdetést kell ellenőrizned a GoFuvar platformon.
Cím: "${title}"
Leírás: "${description || ''}"

Add vissza JSON-ban:
{
  "ok": boolean,    // engedélyezhető-e a hirdetés
  "reason": string, // ha nem ok, miért
  "notes": string   // rövid megjegyzés magyarul
}
Tiltott: illegális áru, fegyver, kábítószer, élő állat embertelen körülmények közt,
félrevezető súly/méret. Csak a JSON-t add vissza.`;
  const result = await model.generateContent(prompt);
  const parsed = safeParseJson(result.response.text()) || {};
  return {
    ok: parsed.ok !== false,
    reason: parsed.reason || null,
    notes: parsed.notes || '',
  };
}

// ---------- AI chatbot (support) ----------
//
// Egy beépített, felhasználó-orientált segéd, ami válaszol a GoFuvar
// platform használatával kapcsolatos kérdésekre. Nem csinál adatbázis-
// műveleteket, csak magyarázatokat és irányítást ad.

const SUPPORT_SYSTEM_PROMPT = `Te a GoFuvar nevű magyar közösségi fuvartőzsde AI segédje vagy.
Magyarul válaszolj, röviden, barátságosan, 2-4 mondatban.

A platform lényege:
- Két szerepkör van: FELADÓ (csomagot ad fel) és SOFŐR (elviszi).
- A feladó fuvart hirdethet meg → a sofőrök licitálnak rá. A feladó
  elfogadja a neki tetsző licitet, és a Barion escrow lefoglalja a pénzt.
- VAGY: a sofőr útvonalat hirdet (pl. "holnap Szegedről Budapestre megyek")
  és megadja, hány Ft-ért vállal kis/közepes/nagy/xl csomagot. A feladók
  FIX áron helyet foglalnak rá, a sofőrnek meg kell erősítenie.
- A fuvar lezárásához a sofőr a telefonjával fotót készít a lerakodott
  csomagról, majd beírja a feladótól kapott 6 számjegyű átvételi kódot.
- A kifizetés a Barionon keresztül megy: 90% a sofőrnek, 10% a platformnak.
- Lemondási díj: ha a feladó mondja le, 10% max 1000 Ft. Ha a sofőr
  mondja le, 100% vissza a feladónak.
- Csomag méret kategóriák: S (max 30×20×10 cm, 2 kg), M (50×40×30, 10 kg),
  L (80×60×50, 25 kg), XL (150×100×80, 50 kg).

Szabályok:
- Mindig magyarul válaszolj.
- Ha a kérdés nem a GoFuvar platformról szól, udvariasan terelgesd
  vissza: "Én a GoFuvar használatában segítek, ebben miben tudok
  segíteni?"
- Ne találj ki olyan funkciót, ami nincs a fenti leírásban.
- Ne adj tanácsot jogi, orvosi, pénzügyi kérdésekben.
- Ha biztosan nem tudod a választ, mondd meg őszintén, és ajánld fel,
  hogy keresse meg az ügyfélszolgálatot.`;

/**
 * Egyszerű chat végpont: egy üzenet + előzmények → egy válasz.
 * @param {string} message – a user új üzenete
 * @param {Array<{role:'user'|'model', content:string}>} history – eddigi beszélgetés
 * @returns {Promise<{reply: string}>}
 */
async function supportChat(message, history = []) {
  if (!message || !message.trim()) {
    return { reply: 'Írj be egy kérdést, és segítek!' };
  }
  const model = getModel();
  if (!model) {
    // STUB válasz, amikor nincs Gemini kulcs beállítva
    return {
      reply:
        'Üdv! Jelenleg offline módban vagyok (nincs Gemini API kulcs beállítva). ' +
        'Az alap funkciókhoz nézd meg a menüpontokat: ' +
        '"Licitálható fuvarok", "Útba eső sofőrök", "Saját fuvaraim".',
    };
  }
  try {
    const chat = model.startChat({
      systemInstruction: { role: 'system', parts: [{ text: SUPPORT_SYSTEM_PROMPT }] },
      history: (history || []).slice(-20).map((m) => ({
        role: m.role === 'assistant' ? 'model' : m.role,
        parts: [{ text: String(m.content || '') }],
      })),
    });
    const result = await chat.sendMessage(message);
    const reply = result.response.text().trim();
    return { reply: reply || 'Bocsánat, most nem tudtam válaszolni. Próbáld újra.' };
  } catch (err) {
    console.error('[gemini] supportChat hiba:', err.message);
    return {
      reply:
        'Bocsánat, most nem érhető el a segéd. Próbáld újra kicsit később, ' +
        'vagy nézd meg a menüpontokat.',
    };
  }
}

module.exports = { analyzeCargoPhoto, reviewJobDescription, supportChat };
