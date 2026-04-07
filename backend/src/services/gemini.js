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

  const prompt = `Te egy logisztikai minőségellenőr vagy a BiztosFuvar platformon.
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
  const prompt = `Egy magyar fuvar-hirdetést kell ellenőrizned a BiztosFuvar platformon.
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

module.exports = { analyzeCargoPhoto, reviewJobDescription };
