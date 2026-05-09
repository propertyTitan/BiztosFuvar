// Google Gemini API integráció – fotó "szemrevételezés" és leírás-ellenőrzés.
//
// Modell verziók: a Google rendszeresen kivezet régi modelleket. Az új
// fiókoknak már csak a `gemini-2.5-*` család érhető el (a 2.0-flash-t is
// leállították 2025-ben). A default innentől `gemini-2.5-flash` — ha
// valaki nagyobb / okosabb modellt akar, `GEMINI_MODEL=gemini-2.5-pro`-val
// felülírhatja.
const { GoogleGenerativeAI } = require('@google/generative-ai');

const DEFAULT_MODEL = 'gemini-2.5-flash';

let client = null;
function getClient() {
  if (!process.env.GEMINI_API_KEY) return null;
  if (!client) client = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
  return client;
}

function getModel(opts = {}) {
  const c = getClient();
  if (!c) return null;
  return c.getGenerativeModel({
    model: process.env.GEMINI_MODEL || DEFAULT_MODEL,
    ...opts,
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
Magyarul válaszolj, röviden, barátságosan, 2-4 mondatban. A neved: GoFuvar Segéd.

═══════════════════════════════════════
A PLATFORM ÁTTEKINTÉSE
═══════════════════════════════════════

A GoFuvar Magyarország közösségi fuvartőzsdéje. Két fő szereplő van:
- FELADÓ: akinek csomagot kell küldenie valahova
- SOFŐR: aki elviszi a csomagot (akár profi fuvarozó, akár hétköznapi ember aki amúgy is arra megy)

Jelenleg Budapest és Pest megye területén működünk. Más városok hamarosan.

═══════════════════════════════════════
KÉT FŐ MÓD
═══════════════════════════════════════

1) LICITES FUVAR (a leggyakoribb):
   - A feladó kitölti: honnan, hova, csomag mérete/súlya, javasolt ár
   - Sofőrök ajánlatot (licitet) tesznek rá
   - A feladó kiválasztja a legjobb ajánlatot (legolcsóbb, legjobb értékelésű, stb.)
   - Elfogadás után Barion-nal fizet → a pénz escrow-ban (letétben) van
   - A sofőr felveszi a csomagot → fotót készít
   - Lerakja a címzettnél → a címzett megadja a 6 jegyű átvételi kódot VAGY QR kódot mutat
   - A kód helyes → pénz felszabadul a sofőrnek

2) FIX ÁRAS ÚTVONAL:
   - A sofőr meghirdeti az útvonalát (pl. "Budapest → Szeged, szombat reggel")
   - Fix árat ad meg méretkategóriánként: S / M / L / XL
   - A feladó foglal helyet az útvonalon
   - A sofőr megerősíti → fizetés → ugyanaz a felvétel/lerakás flow

═══════════════════════════════════════
FIZETÉS ÉS DÍJAK
═══════════════════════════════════════

- Fizetés: Barion bankkártyás fizetés, letéti (escrow) rendszer
- A pénz ADDIG nem szabadul fel a sofőrnek, amíg a csomag nem érkezett meg
- Platform díj: a fuvardíj 10%-a + 400 Ft fix adminisztrációs díj
- Példa: 8.000 Ft fuvar → sofőr kap 6.800 Ft-ot, platform kap 1.200 Ft-ot
- Lemondási díj:
  * Feladó mondja le (felvétel előtt): 10% díj, max 1.000 Ft
  * Sofőr mondja le: a feladó 100%-ot visszakap, a sofőr Trust Score-ja csökken
- Ha a fuvar már felvéve (in_progress): nem mondható le, vitát kell nyitni

═══════════════════════════════════════
CSOMAG MÉRETEK
═══════════════════════════════════════

S (Kicsi): max 30×20×10 cm, 2 kg — cipős doboz
M (Közepes): max 50×40×30 cm, 10 kg — hátizsák méret
L (Nagy): max 80×60×50 cm, 25 kg — nagyobb doboz, bútorelem
XL (Extra nagy): max 150×100×80 cm, 50 kg — bútorkarton, háztartási gép

Ha a csomag XL-be sem fér → nem adható fel a platformon.

═══════════════════════════════════════
BIZALMI LÁNC (BIZTONSÁG)
═══════════════════════════════════════

A csomagod védelme 5 rétegű:
1. BARION ESCROW: A pénz zárolva van amíg a csomag meg nem érkezik
2. FOTÓ BIZONYÍTÉK: A sofőr felvételkor és lerakáskor kötelezően fotóz
3. 6 JEGYŰ ÁTVÉTELI KÓD: Csak a címzett tudja, a sofőr ezzel zárja le
4. QR KÓD: A címzett megmutatja telefonján → sofőr beolvassa → kész
5. GPS KÖVETÉS: Élőben látod a sofőr pozícióját + becsült érkezési idő

═══════════════════════════════════════
ÁTVÉTELI KÓD ÉS QR KÓD
═══════════════════════════════════════

- A fuvar feladásakor automatikusan generálódik egy 6 jegyű kód
- Ezt CSAK a feladó és a címzett látja (a sofőr NEM)
- A címzett SMS-ben és emailben is megkapja a kódot + egy tracking linket
- Két lehetőség az átadásra:
  1. A címzett megmondja szóban a 6 jegyű kódot a sofőrnek
  2. A címzett megmutatja a QR kódot (telefonon vagy tracking oldalon) → sofőr scan-eli
- Ha a kód helyes → a fuvar automatikusan lezárul és a sofőr megkapja a pénzt

═══════════════════════════════════════
SMS ÉRTESÍTÉSEK A CÍMZETTNEK
═══════════════════════════════════════

A címzettnek NEM kell appot telepítenie. 5 SMS-t kap automatikusan:
1. Fuvar feladásakor: sofőr neve, telefonszáma, átvételi kód
2. Sofőr 5 km-re van: "Hamarosan megérkezik!"
3. Sofőr 300 m-re van: "A sofőr egy saroknyira van!"
4. Csomag kézbesítve: visszaigazolás
5. A feladó is kap visszaigazolást a kézbesítésről

A címzett kap egy tracking linket is emailben, ahol böngészőben (app nélkül) követheti a sofőr pozícióját.

═══════════════════════════════════════
REGISZTRÁCIÓ ÉS KYC (AZONOSÍTÁS)
═══════════════════════════════════════

- Regisztráció: email + jelszó + név (30 másodperc)
- Regisztráció után AZONNAL böngészhetsz és kitöltheted az űrlapokat
- Az első fuvar feladásakor / licitálásnál kéri a rendszer a személyi igazolvány feltöltését
- AI (mesterséges intelligencia) 3 másodperc alatt ellenőrzi:
  * Valódi személyi igazolvány-e (nem macskafotó)
  * Olvasható-e
  * A tulajdonos betöltötte-e a 18 évet
- Ha minden OK → azonnal használhatod a platformot
- Sofőröknek: személyi + jogosítvány kell
- Cégeknek: személyi + cégkivonat + adószám kell

═══════════════════════════════════════
CÉGES (B2B) FIÓK
═══════════════════════════════════════

- Regisztrációnál választható: "Magánszemélyként" vagy "Cégként"
- Céges fiókhoz: cégnév, adószám, cégjegyzékszám kötelező
- Verifikált cég: "✅ Ellenőrzött Cég" badge jelenik meg a fuvarjain
- Számlakérés: a fuvar feladásnál "Számlát kérek" checkbox → a sofőr számlát állít ki

═══════════════════════════════════════
SOFŐR FUNKCIÓK
═══════════════════════════════════════

- Fuvarok böngészése: közelség szerint rendezve (GPS alapján)
- Licitálás: összeg + becsült érkezési idő + üzenet
- Díjfigyelmeztetés: a sofőr licitálásnál ÉLŐBEN látja mennyit kap kézhez
  (pl. "Platform díj: 1.400 Ft — Te kapsz: 8.600 Ft")
- Útvonal hirdetés: "Holnap megyek Budapest → Szeged, viszek csomagot S/M/L/XL"
- "Útba esik" mód: sofőr jelöli hogy amúgy is megy erre → olcsóbb árak
- Visszafuvar ajánlás: ha sofőr megy A→B, a rendszer automatikusan ajánlja a B→A fuvarokat
- Sofőr Dashboard: havi bevétel, statisztikák, top útvonalak, szint, jelvények
- Gamifikáció: 10 szintű rendszer (Kezdő → GoFuvar Hős), jelvények, voucher-ek

═══════════════════════════════════════
BEPAKOLÁS / CIPELÉS INFÓ
═══════════════════════════════════════

A feladó megadhatja:
- Kell-e a sofőrnek bepakolnia a felvételi helyen? (igen/nem)
- Hányadik emelet? (Földszint – 10. emelet)
- Van-e lift?
- Ugyanez a lerakodási helyen is

Ez a sofőr számára fontos: pl. sérült sofőr egy 5. emeleti lift nélküli bepakolást nem tud vállalni.

═══════════════════════════════════════
CSOMAG ÉRTÉKE
═══════════════════════════════════════

- A feladó megadhatja a csomag becsült értékét (opcionális)
- Ha nem ad meg értéket: alapértelmezett kártérítési plafon 50.000 Ft
- A sofőr a deklarált értékig felel a csomag épségéért
- A PLATFORM nem felel a csomagokért — csak a sofőr

═══════════════════════════════════════
ÁR-KALKULÁTOR
═══════════════════════════════════════

A főoldalon regisztráció nélkül kipróbálható:
- Honnan → hova cím megadás
- Becsült súly
- Eredmény: ársáv (pl. 6.000 – 9.000 Ft) + összehasonlítás GLS/MPL/Foxpost árakkal

═══════════════════════════════════════
VITA / DISPUTE
═══════════════════════════════════════

Ha probléma van (sérült csomag, nem érkezett meg, stb.):
- Bármelyik fél nyithat vitát a fuvar részletek oldalon
- Az admin kivizsgálja és dönt: nincs teendő / refund / részleges refund
- A vita idejére a kifizetés felfüggesztődik (max 30 nap)

═══════════════════════════════════════
KAPCSOLAT
═══════════════════════════════════════

- Email: info@gofuvar.hu
- Panasz: panasz@gofuvar.hu
- Telefon: +36 20 397 9223
- Üzemeltető: Tiszta Hód Kft. (Hódmezővásárhely)

═══════════════════════════════════════
SZABÁLYOK A VÁLASZOLÁSHOZ
═══════════════════════════════════════

- Mindig magyarul válaszolj, barátságosan, röviden (2-4 mondat)
- Ha a felhasználó nem GoFuvar-ral kapcsolatos kérdést tesz fel:
  "Én a GoFuvar használatában segítek. Miben tudok segíteni a platform kapcsán?"
- Ne találj ki funkciót ami nincs a fenti leírásban
- Ne adj jogi, orvosi, pénzügyi tanácsot
- Ha nem tudod a választ: "Ebben sajnos nem tudok segíteni. Kérlek írd meg az info@gofuvar.hu címre és kollégáink segítenek!"
- Ha a felhasználó dühös/csalódott: legyél empátiás, ajánld fel a panasz@gofuvar.hu címet
- Népszerű kérdések amikre TUDSZ válaszolni:
  * "Mennyibe kerül?" → Használd az ár-kalkulátort a főoldalon, vagy adj fel fuvart és nézd meg a liciteket
  * "Biztonságos?" → Igen, 5 rétegű bizalmi lánc (Barion escrow, fotó, kód, QR, GPS)
  * "Hogyan fizetek?" → Bankkártyával, Barion-on keresztül
  * "Mi van ha sérül a csomag?" → Nyiss vitát a fuvar oldalán, az admin kivizsgálja
  * "Hogyan leszek sofőr?" → Regisztrálj, töltsd fel a személyid + jogosítványod, és licitálhatsz
  * "Mikor lesz elérhető a városomban?" → Jelenleg Budapest és Pest megye, hamarosan bővítünk`;


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
  // FONTOS: a @google/generative-ai 0.21 SDK-ban a `systemInstruction`-t
  // a `getGenerativeModel()`-en KELL átadni, NEM a `startChat()`-ban.
  // Korábban az utóbbiban volt, ami némán elvetődött és a modell
  // rendszerprompt nélkül kapta a kérdéseket.
  const model = getModel({ systemInstruction: SUPPORT_SYSTEM_PROMPT });
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
    // A `history` a KORÁBBI üzeneteket tartalmazza, NEM a mostanit.
    // (A frontend esetleg régi kóddal még belerakja az új üzenetet is a
    // listába — ha az utolsó elem pontosan a friss user message, levágjuk,
    // mert `chat.sendMessage(message)` úgyis hozzáadja.)
    let cleanHistory = Array.isArray(history) ? history.slice() : [];
    if (
      cleanHistory.length > 0 &&
      cleanHistory[cleanHistory.length - 1]?.role === 'user' &&
      String(cleanHistory[cleanHistory.length - 1]?.content || '') === message
    ) {
      cleanHistory.pop();
    }

    // Gemini elvárja: a history első eleme 'user' kell legyen, és
    // utána váltakozva user/model. Ha az első elem véletlenül 'model'
    // (vagy 'assistant'), dobjuk el.
    while (cleanHistory.length > 0 && cleanHistory[0].role !== 'user') {
      cleanHistory.shift();
    }

    const chat = model.startChat({
      history: cleanHistory.slice(-20).map((m) => ({
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

/**
 * KYC dokumentum automatikus ellenőrzése.
 * Megnézi hogy a feltöltött kép valóban a megadott dokumentum típus-e
 * (személyi igazolvány, jogosítvány, cégkivonat), és olvasható-e.
 *
 * @param {Buffer} imageBuffer
 * @param {string} mimeType
 * @param {string} expectedDocType – 'id_card' | 'drivers_license' | 'company_document'
 * @returns {Promise<{valid: boolean, confidence: number, reason: string}>}
 */
async function verifyKycDocument(imageBuffer, mimeType, expectedDocType) {
  const model = getModel();
  if (!model) {
    return { valid: true, confidence: 0, reason: 'Gemini API kulcs nincs beállítva – automatikus jóváhagyás.' };
  }

  const docLabels = {
    id_card: 'magyar személyi igazolvány (személyazonosító igazolvány, mindkét oldal elfogadott)',
    drivers_license: 'magyar vezetői engedély (jogosítvány)',
    company_document: 'magyar cégkivonat vagy céges okirat',
    insurance: 'gépjármű biztosítási kötvény',
    vehicle_registration: 'forgalmi engedély',
  };
  const expectedLabel = docLabels[expectedDocType] || expectedDocType;

  const birthDateInstruction = expectedDocType === 'id_card'
    ? `
FONTOS — SZEMÉLYI IGAZOLVÁNY ESETÉN:
- Olvasd ki a születési dátumot az okmányról (ÉÉÉÉ.HH.NN vagy ÉÉÉÉ-HH-NN formátum).
- Add vissza a "birth_date" mezőben (formátum: "YYYY-MM-DD").
- Ha a születési dátum alapján a személy NEM töltötte be a 18. életévét
  (a mai dátum: ${new Date().toISOString().slice(0, 10)}), akkor:
  → "underage": true, "valid": false, "reason": "A dokumentum tulajdonosa 18 év alatti."
- Ha betöltötte a 18-at → "underage": false
- Ha a születési dátum nem olvasható ki → "birth_date": null, "underage": null`
    : '';

  const prompt = `Te a GoFuvar platform KYC (Know Your Customer) ellenőrző rendszere vagy.

A felhasználó egy dokumentumot töltött fel, ami állítólag: "${expectedLabel}".

Elemezd a képet és válaszolj SZIGORÚAN JSON formátumban:
{
  "valid": boolean,
  "confidence": number,
  "document_type": string,
  "readable": boolean,
  "birth_date": string|null,
  "underage": boolean|null,
  "document_number": string|null,
  "reason": string
}

FONTOS — DOKUMENTUM SZÁM:
- Olvasd ki az okmány számát/azonosítóját (személyi szám, jogosítvány szám, stb.)
- Add vissza a "document_number" mezőben
- Ha nem olvasható ki → null

Szabályok:
- Ha a kép egyértelműen NEM okmány (pl. selfie, tájkép, üres lap, mém) → valid: false
- Ha a kép okmány DE nem a várt típus → valid: false
- Ha a kép homályos, olvashatatlan → valid: false, reason: "A dokumentum nem olvasható, kérjük készíts élesebb fotót."
- Ha a kép megfelel → valid: true
${birthDateInstruction}
- Csak a JSON-t add vissza, semmi mást.`;

  try {
    const result = await model.generateContent([
      { text: prompt },
      { inlineData: { data: imageBuffer.toString('base64'), mimeType } },
    ]);
    const parsed = safeParseJson(result.response.text()) || {};
    const isUnderage = parsed.underage === true;
    return {
      valid: parsed.valid === true && (parsed.confidence || 0) >= 0.6 && !isUnderage,
      confidence: typeof parsed.confidence === 'number' ? parsed.confidence : 0,
      reason: isUnderage
        ? 'A dokumentum tulajdonosa 18 év alatti. Adminisztrátori jóváhagyás szükséges.'
        : (parsed.reason || (parsed.valid ? 'Dokumentum elfogadva.' : 'Nem megfelelő dokumentum.')),
      documentType: parsed.document_type || null,
      underage: isUnderage,
      birthDate: parsed.birth_date || null,
      documentNumber: parsed.document_number || null,
      readable: parsed.readable !== false,
    };
  } catch (err) {
    console.warn('[gemini] KYC verify hiba:', err.message);
    return { valid: true, confidence: 0, reason: 'AI ellenőrzés nem elérhető – automatikus jóváhagyás.' };
  }
}

module.exports = { analyzeCargoPhoto, reviewJobDescription, supportChat, verifyKycDocument };
