// =====================================================================
//  GEMINI: AMIT AZ AI ROSSZUL MOND (2026-08-12)
//
//  ⚠️ 27,6%-OS ELÁGAZÁS-LEFEDETTSÉGEN ÁLLT — pedig ennek a modulnak a
//  kimenete KYC-DÖNTÉST befolyásol. A `verifyKycDocument` válasza dönti el,
//  hogy egy szállító azonnal 'verified' lesz-e, vagy emberhez kerül. Két
//  irányban lehet drága:
//
//    - TÚL ENGEDÉKENY: egy szemét/hamis AI-válaszra `valid: true` → a
//      „minden szállító személyivel igazolt" ígéret és az „egy okmány = egy
//      fiók" csalásvédelem is némán kiesik.
//    - TÚL SZIGORÚ: egy félreolvasásra végleges elutasítás → jóhiszemű
//      felhasználót zárnánk ki a keresetszerzéstől (GDPR 22. cikk).
//
//  Az eddigi tesztek a DÖNTÉSI RÉTEGET mérték (kycReview.js), de senki nem
//  mérte azt, ami a döntés BEMENETE. Ez a fájl a Gemini-oldali hibaágakat
//  méri: nem-JSON válasz, hiányzó mező, rossz típus, extrém bizalom,
//  API-hiba, timeout, kulcs nélküli STUB mód.
//
//  ⚠️ SOHA NEM MEGY KI HÁLÓZATRA. A `@google/generative-ai` modult a CJS-
//  cache-be tett hamis változat helyettesíti, ÉS a `global.fetch` is
//  csapdázva van — a fájl végén külön teszt bizonyítja, hogy egyetlen valódi
//  (fizetős) Gemini-hívás sem indult.
// =====================================================================
import {
  describe, it, expect, beforeEach, afterEach, afterAll, vi,
} from 'vitest';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);
const Module = require('module');

const SDK_UT = require.resolve('@google/generative-ai');
const GEMINI_UT = require.resolve('../src/services/gemini');
const EREDETI_SDK = require.cache[SDK_UT];
const EREDETI_GEMINI = require.cache[GEMINI_UT];
const EREDETI_KULCS = process.env.GEMINI_API_KEY;

/** A hamis SDK naplója — mit kapott a modell, és hányszor. */
let naplo;

/**
 * Hamis @google/generative-ai a CJS-cache-be. A `valaszAdo` vagy egy stringet
 * ad vissza (ezt „mondja" az AI), vagy dob (API-hiba / timeout).
 */
function telepitHamisSdk(valaszAdo) {
  class HamisGenAI {
    constructor(kulcs) { naplo.kulcs = kulcs; }

    getGenerativeModel(opts) {
      naplo.modelOpts.push(opts);
      const valasz = async (bemenet) => {
        naplo.hivasok.push(bemenet);
        const t = await valaszAdo(bemenet);
        return { response: { text: () => t } };
      };
      return {
        generateContent: valasz,
        startChat: (cfg) => {
          naplo.chatCfg.push(cfg);
          return { sendMessage: valasz };
        },
      };
    }
  }
  const m = new Module(SDK_UT, null);
  m.filename = SDK_UT;
  m.loaded = true;
  m.exports = { GoogleGenerativeAI: HamisGenAI };
  require.cache[SDK_UT] = m;
}

/** Friss gemini-modul a hamis SDK-val. `kulcs: null` → STUB mód. */
function betoltGemini({ kulcs = 'teszt-gemini-kulcs', valaszAdo = async () => '{}' } = {}) {
  naplo = { kulcs: null, modelOpts: [], chatCfg: [], hivasok: [] };
  telepitHamisSdk(valaszAdo);
  if (kulcs === null) process.env.GEMINI_API_KEY = '';
  else process.env.GEMINI_API_KEY = kulcs;
  delete require.cache[GEMINI_UT];
  return require(GEMINI_UT);
}

/** Az AI válasza kész JSON-objektumból. */
const json = (o) => async () => JSON.stringify(o);

const KEP = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10]);

let halozatiHivasok;
beforeEach(() => {
  // ⚠️ BIZTONSÁGI HÁLÓ: ha a hamis SDK-telepítés valaha elromlik, a valódi
  // SDK hálózatra menne (fizetős hívás, éles kulccsal). Itt elakad.
  halozatiHivasok = [];
  vi.spyOn(global, 'fetch').mockImplementation((u) => {
    halozatiHivasok.push(String(u));
    throw new Error('TILOS: valódi hálózati hívás a Gemini-tesztben');
  });
});

afterEach(() => { vi.restoreAllMocks(); });

afterAll(() => {
  // Az eredeti modulokat visszatesszük, hogy a worker többi fájlja ne
  // örökölje a hamis SDK-t.
  if (EREDETI_SDK) require.cache[SDK_UT] = EREDETI_SDK; else delete require.cache[SDK_UT];
  if (EREDETI_GEMINI) require.cache[GEMINI_UT] = EREDETI_GEMINI; else delete require.cache[GEMINI_UT];
  if (EREDETI_KULCS === undefined) delete process.env.GEMINI_API_KEY;
  else process.env.GEMINI_API_KEY = EREDETI_KULCS;
});

// =====================================================================
//  1) STUB MÓD — nincs API-kulcs (fejlesztés, kulcs-kiesés, elgépelt env)
// =====================================================================
describe('STUB mód: kulcs nélkül mit csinál a modul', () => {
  it('a KYC-ellenőrzés FAIL-CLOSED: sosem hagy jóvá kulcs nélkül', async () => {
    const gemini = betoltGemini({ kulcs: null });
    const r = await gemini.verifyKycDocument(KEP, 'image/jpeg', 'id_card');

    expect(
      r.valid,
      'AI-KULCS NÉLKÜL ÉRVÉNYESNEK MONDTUK A DOKUMENTUMOT.\n\n'
      + 'Ez a legdrágább néma hiba: egy elgépelt/lejárt GEMINI_API_KEY-jel MINDEN\n'
      + 'feltöltött kép (macskafotó is) átmenne, a 18+ ellenőrzés és az „egy\n'
      + 'okmány = egy fiók" csalásvédelem pedig teljesen kiesne.',
    ).toBe(false);
    expect(
      r.pending,
      'a kulcs-hiány nem terelte emberi ellenőrzésre (pending) — a route ebből '
      + 'a mezőből tudja, hogy adminhoz kell küldeni, nem elutasítani',
    ).toBe(true);
    expect(r.confidence).toBe(0);
  });

  it('a fuvarfotó-elemzés stub válasza NULLA bizalmat jelent', async () => {
    const gemini = betoltGemini({ kulcs: null });
    const r = await gemini.analyzeCargoPhoto(KEP, 'image/jpeg', 'pickup');
    expect(
      r.confidence,
      'a stub válasz nem-nulla bizalmat adott — egy hívó ebből azt hinné, '
      + 'hogy valódi AI-elemzés történt',
    ).toBe(0);
    expect(r.raw, 'a stub válaszban nyers AI-adat szerepel, pedig nem volt hívás').toBeNull();
  });

  it('a hirdetés-ellenőrzés kulcs nélkül ENGEDÉKENY (a feladás ne akadjon el)', async () => {
    const gemini = betoltGemini({ kulcs: null });
    const r = await gemini.reviewJobDescription('Bútor szállítás', 'két fotel');
    expect(
      r.ok,
      'a hirdetés-ellenőrzés kulcs nélkül elutasított — ez fordított politika, '
      + 'mint a KYC-nél: itt a fail-OPEN a szándék (a hirdetés csak tájékoztató '
      + 'szűrés, a determinisztikus kapu a jobs.js-ben van)',
    ).toBe(true);
  });

  it('a chatbot kulcs nélkül offline üzenetet ad, nem üres választ', async () => {
    const gemini = betoltGemini({ kulcs: null });
    const r = await gemini.supportChat('Hol adok fel fuvart?');
    expect(typeof r.reply).toBe('string');
    expect(r.reply.length, 'a stub chat üres választ adott vissza').toBeGreaterThan(20);
  });

  it('STUB módban egyetlen modell-példány sem jön létre (nincs kvóta-költés)', async () => {
    const gemini = betoltGemini({ kulcs: null });
    await gemini.verifyKycDocument(KEP, 'image/jpeg', 'id_card');
    await gemini.analyzeCargoPhoto(KEP, 'image/jpeg');
    await gemini.supportChat('szia');
    expect(
      naplo.modelOpts.length,
      'kulcs nélkül is példányosítottunk modellt — a stub-kapu nem a hívás ELŐTT van',
    ).toBe(0);
  });
});

// =====================================================================
//  2) A KYC-ELLENŐRZÉS HIBAÁGAI — ez befolyásol emberi sorsot
// =====================================================================
describe('KYC-ellenőrzés: szemét, hiányos és extrém AI-válaszok', () => {
  it('nem-JSON válasz (az AI „elmagyaráz") → NEM érvényes dokumentum', async () => {
    const gemini = betoltGemini({
      valaszAdo: async () => 'Sajnálom, nem tudom értelmezni ezt a képet. Kérlek töltsd fel újra.',
    });
    const r = await gemini.verifyKycDocument(KEP, 'image/jpeg', 'id_card');
    expect(
      r.valid,
      'a parse-olhatatlan AI-válaszból ÉRVÉNYES dokumentum lett.\n'
      + 'Egy modellváltás vagy egy prompt-elcsúszás elég ahhoz, hogy az AI '
      + 'prózával válaszoljon — ilyenkor SOHA nem szabad jóváhagyni.',
    ).toBe(false);
    expect(r.confidence, 'a parse-olhatatlan válaszhoz nem-nulla bizalmat rendeltünk').toBe(0);
  });

  it('érvénytelen JSON a ```json blokkban → NEM érvényes', async () => {
    const gemini = betoltGemini({
      valaszAdo: async () => '```json\n{ "valid": true, "confidence": 0.99,\n```',
    });
    const r = await gemini.verifyKycDocument(KEP, 'image/jpeg', 'id_card');
    expect(r.valid, 'a csonka JSON-t érvényesnek fogadtuk el').toBe(false);
  });

  it('```json blokkba csomagolt HELYES választ ki tudja bontani', async () => {
    const gemini = betoltGemini({
      valaszAdo: async () => 'Íme az eredmény:\n```json\n{"valid":true,"confidence":0.97,'
        + '"document_number":"AB123456","holder_name":"Kovács Anna","likely_copy":false}\n```\nRemélem segített!',
    });
    const r = await gemini.verifyKycDocument(KEP, 'image/jpeg', 'id_card');
    expect(
      r.valid,
      'a ```json kerítésbe zárt (a Gemini legtipikusabb alakja) választ nem '
      + 'tudtuk kibontani — ettől MINDEN valódi feltöltés emberi sorba kerülne',
    ).toBe(true);
    expect(r.documentNumber).toBe('AB123456');
    expect(r.holderName).toBe('Kovács Anna');
  });

  it('a bizalmi küszöb pontosan 0,6-nál vált (határ-mérés)', async () => {
    const alatta = betoltGemini({ valaszAdo: json({ valid: true, confidence: 0.59 }) });
    expect(
      (await alatta.verifyKycDocument(KEP, 'image/jpeg', 'id_card')).valid,
      '0,59-es bizalommal is jóváhagytunk — a küszöb elcsúszott lefelé',
    ).toBe(false);

    const pontosan = betoltGemini({ valaszAdo: json({ valid: true, confidence: 0.6 }) });
    expect(
      (await pontosan.verifyKycDocument(KEP, 'image/jpeg', 'id_card')).valid,
      'pontosan a 0,6-os küszöbön elutasítottunk — a határ szigorúbb lett, mint a szabály',
    ).toBe(true);
  });

  it('18 év alatti → valid:false ÉS a felhasználónak szóló indok is ezt mondja', async () => {
    const gemini = betoltGemini({
      valaszAdo: json({
        valid: true, confidence: 0.99, underage: true, birth_date: '2012-05-05',
        reason: 'Minden rendben.',
      }),
    });
    const r = await gemini.verifyKycDocument(KEP, 'image/jpeg', 'id_card');
    expect(
      r.valid,
      '18 ÉV ALATTI OKMÁNYT ÉRVÉNYESNEK MONDTUNK. Az ÁSZF 3.1 szerint a '
      + 'platform 18+ — ez jogi kapu, nem kényelmi szűrés.',
    ).toBe(false);
    expect(r.underage).toBe(true);
    expect(
      r.reason,
      'az AI saját „Minden rendben" indoka került a felhasználóhoz a 18-alatti '
      + 'jelzés helyett — az admin és a user is félrevezetve lenne',
    ).toMatch(/18 év alatti/);
  });

  it('a hiányzó mezők nem szivárognak undefined-ként a döntési rétegbe', async () => {
    // Az AI válaszol, de csak a minimumot adja vissza.
    const gemini = betoltGemini({ valaszAdo: json({ valid: true, confidence: 0.9 }) });
    const r = await gemini.verifyKycDocument(KEP, 'image/jpeg', 'id_card');
    expect(r.documentNumber, 'a hiányzó okmányszám nem null-ként jött vissza').toBeNull();
    expect(r.holderName, 'a hiányzó tulajdonos-név nem null-ként jött vissza').toBeNull();
    expect(r.likelyCopy, 'a hiányzó másolat-gyanú nem false-ként jött vissza').toBe(false);
    expect(
      r.readable,
      'a hiányzó `readable` mezőt olvashatatlannak vettük — a legtöbb valós '
      + 'válaszban nincs benne, így minden feltöltés hibásan „olvashatatlan" lenne',
    ).toBe(true);

    // A kycReview a `documentNumber` hiányából tudja, hogy emberhez kell terelni.
    const { needsManualReview } = require('../src/services/kycReview');
    expect(
      needsManualReview(r, { fullName: 'Kovács Anna' }, 'id_card')?.code,
      'olvashatatlan okmányszámnál a duplikátum-védelem némán kimarad, ha a '
      + 'döntési réteg nem kap egyértelmű null-t',
    ).toBe('NO_DOC_NUMBER');
  });

  it('rossz TÍPUSÚ mezők (string bizalom, szám név) nem törik el a modult', async () => {
    const gemini = betoltGemini({
      valaszAdo: json({ valid: 'igen', confidence: '0.99', holder_name: 12345, readable: 'talán' }),
    });
    const r = await gemini.verifyKycDocument(KEP, 'image/jpeg', 'id_card');
    expect(
      r.valid,
      'a `valid: "igen"` (string) érvényesnek számított — a szigorú === '
      + 'ellenőrzés kilazult, és egy laza AI-válasz jóváhagyást eredményez',
    ).toBe(false);
    expect(
      r.confidence,
      'a string bizalom számként került a kimenetre — a döntési réteg (0,85-ös '
      + 'küszöb) számot vár, string összehasonlításból néma auto-approve lehet',
    ).toBe(0);
  });

  it('API-hiba (kvóta, timeout, hálózat) → FAIL-CLOSED, emberi ellenőrzés', async () => {
    const gemini = betoltGemini({
      valaszAdo: async () => { throw new Error('429 Too Many Requests'); },
    });
    const r = await gemini.verifyKycDocument(KEP, 'image/jpeg', 'id_card');
    expect(r.valid, 'AI-hibánál is jóváhagytunk').toBe(false);
    expect(
      r.pending,
      'AI-HIBÁNÁL NEM EMBERHEZ TEREL. A route a `pending` mezőből tudja, hogy '
      + '„nem tudtuk ellenőrizni" (admin-értesítés) — enélkül a felhasználó '
      + 'egy átmeneti kvóta-hibából végleges elutasítást kapna.',
    ).toBe(true);
  });

  it('a KYC-hívás sosem dob (a feltöltési tranzakció nem fordulhat meg)', async () => {
    const gemini = betoltGemini({
      valaszAdo: async () => { throw Object.assign(new Error('szétesett'), { code: 'ECONNRESET' }); },
    });
    await expect(
      gemini.verifyKycDocument(KEP, 'image/jpeg', 'id_card'),
      'a KYC-ellenőrzés kidobta a hibát — a feltöltés 500-zal szállna el, '
      + 'miközben a fotó MÁR a privát bucketben van (árva fájl)',
    ).resolves.toBeTruthy();
  });

  it('személyi igazolványnál a prompt tartalmazza a 18-év ellenőrzést, másnál nem', async () => {
    const gemini = betoltGemini({ valaszAdo: json({ valid: true, confidence: 0.9 }) });
    await gemini.verifyKycDocument(KEP, 'image/jpeg', 'id_card');
    const idPrompt = naplo.hivasok[0][0].text;
    expect(
      idPrompt,
      'a személyi igazolvány promptjából kimaradt a 18-év ellenőrzés — az '
      + 'underage mező sosem lenne kitöltve, a kiskorú-kapu némán kiesne',
    ).toMatch(/18\. életévét/);
    expect(
      idPrompt,
      'a prompt nem tartalmazza a MAI dátumot, így az AI-nak nincs mihez '
      + 'viszonyítania a születési dátumot',
    ).toContain(new Date().toISOString().slice(0, 10));

    const masik = betoltGemini({ valaszAdo: json({ valid: true, confidence: 0.9 }) });
    await masik.verifyKycDocument(KEP, 'image/jpeg', 'company_document');
    expect(
      naplo.hivasok[0][0].text,
      'céges iratnál is a születési dátumot kérjük — fölösleges személyes '
      + 'adatot kérnénk be (adat-minimalizálás)',
    ).not.toMatch(/18\. életévét/);
  });

  it('ÜRES AI-válasz (a modell elhallgat) → nem érvényes dokumentum', async () => {
    const gemini = betoltGemini({ valaszAdo: async () => '' });
    const r = await gemini.verifyKycDocument(KEP, 'image/jpeg', 'id_card');
    expect(
      r.valid,
      'az ÜRES AI-válaszból érvényes dokumentum lett. A Gemini biztonsági '
      + 'szűrője (safety block) pontosan így viselkedik: nem hibázik, csak '
      + 'üres szöveget ad — ilyenkor SEMMIT nem tudunk az okmányról.',
    ).toBe(false);
  });

  it('ismeretlen dokumentum-típusnál sem megy „undefined" a promptba', async () => {
    const gemini = betoltGemini({ valaszAdo: json({ valid: true, confidence: 0.9 }) });
    await gemini.verifyKycDocument(KEP, 'image/jpeg', 'utlevel');
    const p = naplo.hivasok[0][0].text;
    expect(
      p,
      'ismeretlen okmány-típusnál „undefined" került a promptba — az AI azt '
      + 'ellenőrizné, hogy a kép egy „undefined"-e',
    ).not.toMatch(/állítólag: "undefined"/);
    expect(p).toContain('"utlevel"');
  });

  it('a kép a hívásba kerül base64-ként, a helyes MIME-típussal', async () => {
    const gemini = betoltGemini({ valaszAdo: json({ valid: true, confidence: 0.9 }) });
    await gemini.verifyKycDocument(KEP, 'image/png', 'id_card');
    const kepResz = naplo.hivasok[0][1];
    expect(kepResz.inlineData.mimeType, 'a MIME-típus nem jutott át az AI-hoz').toBe('image/png');
    expect(
      kepResz.inlineData.data,
      'a kép nem base64-ként ment ki — a Gemini nyers bájtot nem fogad',
    ).toBe(KEP.toString('base64'));
  });
});

// =====================================================================
//  3) FUVARFOTÓ-ELEMZÉS
// =====================================================================
describe('Fuvarfotó-elemzés: szigorú típus-kezelés', () => {
  it('a nem-boolean has_cargo nem számít „van áru"-nak', async () => {
    const gemini = betoltGemini({ valaszAdo: json({ has_cargo: 'igen', confidence: 0.9 }) });
    const r = await gemini.analyzeCargoPhoto(KEP, 'image/jpeg', 'pickup');
    expect(
      r.has_cargo,
      'a `"igen"` string igaznak számított — bármilyen nem-üres AI-szöveg '
      + '„van áru"-t jelentene',
    ).toBe(false);
  });

  it('parse-olhatatlan válasznál a nyers szöveget megőrzi a naplóhoz', async () => {
    const gemini = betoltGemini({ valaszAdo: async () => 'ez nem json' });
    const r = await gemini.analyzeCargoPhoto(KEP, 'image/jpeg');
    expect(
      r.raw?.text,
      'a parse-olhatatlan AI-választ eldobtuk — a hibakereséshez semmi nem marad',
    ).toBe('ez nem json');
    expect(r.notes, 'a hiányzó megjegyzés nem üres stringre esett vissza').toBe('');
  });

  it('a kép típusa (pickup/dropoff/damage) bekerül a promptba', async () => {
    const gemini = betoltGemini({ valaszAdo: json({ has_cargo: true, confidence: 0.8 }) });
    await gemini.analyzeCargoPhoto(KEP, 'image/jpeg', 'damage');
    expect(
      naplo.hivasok[0][0].text,
      'a fotó típusa nem jutott át a promptba — a sérülés-fotót ugyanúgy '
      + 'elemeznénk, mint egy felvételit',
    ).toContain('"damage"');
  });
});

// =====================================================================
//  4) HIRDETÉS-ELLENŐRZÉS — a KYC-vel ELLENTÉTES politika (fail-open)
// =====================================================================
describe('Hirdetés-ellenőrzés', () => {
  it('csak a KIFEJEZETT ok:false tiltja a hirdetést', async () => {
    const tilt = betoltGemini({ valaszAdo: json({ ok: false, reason: 'fegyver' }) });
    const r1 = await tilt.reviewJobDescription('Pisztoly', 'gyűjtői darab');
    expect(r1.ok, 'a kifejezett tiltást nem vettük figyelembe').toBe(false);
    expect(r1.reason).toBe('fegyver');

    const szemet = betoltGemini({ valaszAdo: async () => 'nem tudom eldönteni' });
    expect(
      (await szemet.reviewJobDescription('Doboz', 'könyvek')).ok,
      'egy értelmezhetetlen AI-válasz megtiltotta a hirdetést — a feladási '
      + 'folyamat az AI hangulatától függene',
    ).toBe(true);
    expect(
      (await szemet.reviewJobDescription('Doboz', 'könyvek')).reason,
      'a hiányzó indok nem null-ként jött vissza',
    ).toBeNull();
  });

  it('a cím és a leírás is bekerül a promptba (üres leírás sem töri el)', async () => {
    const gemini = betoltGemini({ valaszAdo: json({ ok: true }) });
    await gemini.reviewJobDescription('Költöztetés Szegedre', null);
    expect(naplo.hivasok[0], 'a hirdetés címe nem jutott át az AI-hoz').toContain('Költöztetés Szegedre');
    expect(
      naplo.hivasok[0],
      'a null leírásból "null" szöveg lett a promptban',
    ).not.toContain('null"');
  });
});

// =====================================================================
//  5) CHATBOT — előzmény-higiénia és hibatűrés
// =====================================================================
describe('Chatbot (supportChat)', () => {
  it('üres/whitespace üzenetre nem hív AI-t', async () => {
    const gemini = betoltGemini();
    for (const uz of ['', '   ', null, undefined]) {
      const r = await gemini.supportChat(uz, []);
      expect(r.reply.length).toBeGreaterThan(0);
    }
    expect(
      naplo.modelOpts.length,
      'üres üzenetre is elindítottunk egy (fizetős) Gemini-hívást',
    ).toBe(0);
  });

  it('a rendszerprompt a MODELL-en megy át, nem a startChat-ben', async () => {
    // Ez egy már MEGTÖRTÉNT hiba őre: a 0.21-es SDK a startChat-ben átadott
    // systemInstruction-t NÉMÁN elveti, és a modell rendszerprompt nélkül
    // válaszol (ekkor kezdene App Store-t emlegetni, ami nincs).
    const gemini = betoltGemini({ valaszAdo: async () => 'Szia!' });
    await gemini.supportChat('Van appotok?', []);
    expect(
      naplo.modelOpts[0]?.systemInstruction,
      'a rendszerprompt nem a getGenerativeModel()-en ment át — a 0.21-es SDK '
      + 'a startChat-ben átadottat NÉMÁN elveti, és a chatbot tudás nélkül válaszol',
    ).toBeTruthy();
    expect(
      naplo.chatCfg[0]?.systemInstruction,
      'a rendszerprompt (fölöslegesen) a startChat-ben is át lett adva',
    ).toBeUndefined();
  });

  it('a rendszerprompt tiltja az App Store-ra hivatkozást (nincs natív app)', async () => {
    const gemini = betoltGemini({ valaszAdo: async () => 'ok' });
    await gemini.supportChat('Hol töltöm le?', []);
    const p = String(naplo.modelOpts[0].systemInstruction);
    expect(
      /App Store/i.test(p) && /TILOS/.test(p),
      'a rendszerpromptból eltűnt az App Store-tiltás. A Gemini SAJÁT '
      + 'tudásbázisa alapján logikusnak tartaná az „keresd az App Store-ban" '
      + 'választ — ez HAMIS, és a felhasználót körbe küldi.',
    ).toBe(true);
  });

  it('a friss üzenetet nem duplikáljuk az előzményből', async () => {
    const gemini = betoltGemini({ valaszAdo: async () => 'ok' });
    await gemini.supportChat('Mennyibe kerül?', [
      { role: 'user', content: 'Szia' },
      { role: 'model', content: 'Szia, miben segíthetek?' },
      { role: 'user', content: 'Mennyibe kerül?' }, // = a friss üzenet
    ]);
    const h = naplo.chatCfg[0].history;
    expect(
      h.length,
      'a friss üzenet az előzményben IS bennmaradt — a modell kétszer látja '
      + 'ugyanazt a kérdést, és a Gemini a záró user-fordulóra hibát is adhat',
    ).toBe(2);
    expect(h[h.length - 1].role).toBe('model');
  });

  it('a „model"-lel kezdődő előzményt levágja (a Gemini elutasítaná)', async () => {
    const gemini = betoltGemini({ valaszAdo: async () => 'ok' });
    await gemini.supportChat('Szia', [
      { role: 'model', content: 'Üdv! Miben segíthetek?' },
      { role: 'user', content: 'Hol adok fel fuvart?' },
      { role: 'assistant', content: 'A dashboardon.' },
    ]);
    const h = naplo.chatCfg[0].history;
    expect(
      h[0].role,
      'az előzmény „model" szereppel kezdődik — a Gemini API ezt elutasítja, '
      + 'és a chatbot MINDEN válasza hibára futna',
    ).toBe('user');
    expect(
      h[1].role,
      'az „assistant" szerepet nem képeztük le „model"-re (a Gemini nem ismeri)',
    ).toBe('model');
  });

  it('hosszú előzményből csak az utolsó 20 fordulót küldi el', async () => {
    const gemini = betoltGemini({ valaszAdo: async () => 'ok' });
    const hosszu = [];
    for (let i = 0; i < 60; i += 1) {
      hosszu.push({ role: i % 2 === 0 ? 'user' : 'model', content: `uzenet-${i}` });
    }
    await gemini.supportChat('friss kérdés', hosszu);
    expect(
      naplo.chatCfg[0].history.length,
      'a teljes előzményt elküldtük — a token-költség (és a válaszidő) a '
      + 'beszélgetés hosszával korlátlanul nőne',
    ).toBe(20);
  });

  it('AI-hiba esetén barátságos üzenet jön vissza, nem kivétel', async () => {
    const gemini = betoltGemini({
      valaszAdo: async () => { throw new Error('503 Service Unavailable'); },
    });
    const r = await gemini.supportChat('Szia', []);
    expect(
      r.reply,
      'a chatbot hibája kivételként jött vissza — a /ai/chat végpont 500-at '
      + 'adna, és a felhasználó egy néma hibaképernyőt kapna',
    ).toMatch(/nem érhető el|Próbáld újra/);
  });

  it('üres AI-válaszra sem küldünk üres buborékot', async () => {
    const gemini = betoltGemini({ valaszAdo: async () => '   ' });
    const r = await gemini.supportChat('Szia', []);
    expect(r.reply.trim().length, 'a chatbot üres buborékot küldött').toBeGreaterThan(0);
  });

  it('nem tömb előzmény (pl. objektum) nem töri el a hívást', async () => {
    const gemini = betoltGemini({ valaszAdo: async () => 'ok' });
    const r = await gemini.supportChat('Szia', { nem: 'tomb' });
    expect(r.reply, 'rossz típusú előzményre elszállt a chat').toBe('ok');
    expect(naplo.chatCfg[0].history).toEqual([]);
  });
});

// =====================================================================
//  6) A TESZT SAJÁT BIZTONSÁGA
// =====================================================================
describe('A teszt nem megy ki hálózatra', () => {
  it('egyetlen valódi HTTP-hívás sem indult a fájl futása alatt', async () => {
    const gemini = betoltGemini({ valaszAdo: json({ valid: true, confidence: 0.9 }) });
    await gemini.verifyKycDocument(KEP, 'image/jpeg', 'id_card');
    expect(
      halozatiHivasok,
      'VALÓDI hálózati hívás indult a Gemini-tesztből. A hamis SDK nem került '
      + 'a helyére — élesben ez FIZETŐS AI-hívás lenne, éles kulccsal, '
      + 'okmányfotóval a testben.',
    ).toEqual([]);
  });
});
