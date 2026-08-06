#!/usr/bin/env node
/* eslint-disable no-console */
// =====================================================================
//  AI FELDERÍTŐ TESZTELŐ — „a user el fogja rontani"
//
//  Mit csinál: elindít egy böngészőt, és egy LLM-et ültet a kormányhoz
//  azzal az utasítással, hogy ROSSZINDULATÚ, ZAVARODOTT és TÜRELMETLEN
//  felhasználóként használja az oldalt. Közben a szkript FOLYAMATOSAN
//  méri a valódi tüneteket (JS-hiba, 500-as válasz, elakadt kérés), és a
//  végén jelentést ír.
//
//  MIÉRT KELL, ha van 175 backend + 87 unit + 34 E2E tesztünk:
//    A determinisztikus tesztek azt őrzik, amit MÁR TUDUNK. Az AI-tesztelő
//    olyan ÚJ hibaosztályt keres, amire nem gondoltunk — pontosan úgy,
//    ahogy egy emberi tesztelő. A találatait NEM itt hagyjuk: amit talál,
//    abból determinisztikus tesztet írunk, és az őrzi tovább.
//
//  MIT NEM CSINÁL:
//    - Nem gyors (percek), nem ingyenes (LLM-hívások), nem determinisztikus.
//    - NEM való CI-be. Ez egy kutató eszköz, nem kapuőr.
//    - A találatait EMBERNEK kell átnéznie: lesz köztük téves riasztás.
//
//  Használat:
//    cd web && node scripts/ai-tesztelo.mjs                 # localhost:3000
//    BASE_URL=http://localhost:3100 node scripts/ai-tesztelo.mjs
//    LEPESEK=60 SZEMELY=zavarodott node scripts/ai-tesztelo.mjs
//
//  Kulcs (az egyiket állítsd be):
//    ANTHROPIC_API_KEY  → Claude (ajánlott: jobb az ilyen ügynök-hurokban)
//    GEMINI_API_KEY     → Gemini (a projektben már fizetett szolgáltatás)
// =====================================================================

import { chromium } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';

const BASE_URL = process.env.BASE_URL || 'http://localhost:3000';
const LEPESEK = Number(process.env.LEPESEK || 40);
const SZEMELY = process.env.SZEMELY || 'rosszindulatu';
const FEJLEC_NELKUL = process.env.LATHATO !== '1';
const KIMENET = process.env.KIMENET || path.join('ai-teszt-jelentes.md');

// ── Éles oldal védelme ────────────────────────────────────────────────
// Az ügynök valódi fuvarokat adna fel és valódi üzeneteket küldene.
if (/gofuvar\.hu/i.test(BASE_URL) && process.env.ELES_ENGEDELY !== 'igen') {
  console.error(
    'ELUTASÍTVA: ez az eszköz adatot HOZ LÉTRE (fuvar, üzenet, vita).\n' +
    'Az éles oldalon szemetet csinálna és valódi értesítéseket küldene.\n' +
    'Futtasd lokálisan, vagy ha tényleg ezt akarod: ELES_ENGEDELY=igen',
  );
  process.exit(1);
}

// =====================================================================
//  A PROMPT — ez az eszköz lelke
// =====================================================================

const SZEMELYISEGEK = {
  rosszindulatu: `Rosszindulatú felhasználó vagy. Nem hackelni akarsz, hanem
KIHASZNÁLNI a rendszert: ingyen szolgáltatást, mások adatait, kikerülni a
fizetést. Kipróbálod, mi történik, ha nem a kijelölt úton mész.`,

  zavarodott: `Zavarodott, nem túl gyakorlott felhasználó vagy. Nem olvasod el
a szövegeket, rossz mezőbe írsz, félreérted a gombokat, ötször rákattintasz
mindenre, és nem érted, miért nem történik semmi.`,

  turelmetlen: `Türelmetlen felhasználó vagy. Mindent kétszer-háromszor
megnyomsz, nem várod meg a betöltést, közben nyomkodod a Vissza gombot és
frissítesz, félbehagyod a folyamatokat és máshol folytatod.`,
};

const RENDSZER_PROMPT = `Te egy TAPASZTALT SZOFTVERTESZTELŐ vagy, aki egy magyar
fuvarközvetítő weboldalt (GoFuvar) tesztel egy böngészőn keresztül.

# A KIINDULÓPONTOD
"A felhasználó EL FOGJA RONTANI." Nem az a dolgod, hogy bizonyítsd: a helyes út
működik — azt már 300 automata teszt őrzi. A te dolgod megtalálni, hol OKOZ KÁRT
vagy ZAVART az, ha valaki NEM a kijelölt úton megy.

# A SZEREPED MOST
${SZEMELYISEGEK[SZEMELY] || SZEMELYISEGEK.rosszindulatu}

# MI SZÁMÍT TALÁLATNAK (súlyosság szerint)
- **kritikus**: pénz vagy adat sérül. Fizetés nélkül jutsz szolgáltatáshoz;
  más felhasználó adatát (telefonszám, e-mail, átvételi kód) látod; olyat
  törölsz/módosítasz, ami nem a tiéd; kétszer terhelnek.
- **magas**: a folyamat elakad és nincs kiút (a user beragad); adatvesztés
  (kitöltött űrlap eltűnik); a rendszer hazudik (sikert mutat, de nem történt meg).
- **közepes**: félrevezető vagy hiányzó hibaüzenet; a gomb nem csinál semmit és
  nem is mondja meg, miért; ellentmondó információ két képernyő közt.
- **alacsony**: zavaró szöveg, rossz elrendezés, hiányzó visszajelzés.

# AMIT NE JELENTS
- Szépészeti apróságot (szín, 2 pixel), ha nem akadályoz semmit.
- "Hamarosan"-nak jelölt funkciót (pl. élő GPS-követés) — ez tudott.
- Azt, hogy egy külső szolgáltatás teszt módban van (fizetés-szimuláció).
- Ugyanazt a hibát többször.

# ÜZLETI SZABÁLYOK, amiket ismerned kell (ha ezek sérülnek, az KRITIKUS)
- A szállító telefonszáma/e-mailje CSAK a kapcsolatfelvételi díj kifizetése
  UTÁN látszódhat. Ha díjfizetés nélkül elérhetőséghez jutsz, az kritikus.
- A fuvardíjat a platform SOHA nem kezeli — csak a kapcsolatfelvételi díjat
  (bevezető ár: 500 Ft 50 000 Ft-ig, felette 1 000 Ft).
- NINCS mobilalkalmazás. Ha bárhol app letöltését ígérik, az találat.
- A felvételi és lerakodási címnek HÁZSZÁMIG pontosnak kell lennie.
- Múltbeli időpontra nem lehet járatot hirdetni.
- Ha nem a feladó veszi át a csomagot, a címzett neve ÉS telefonszáma kötelező.

# HOGYAN DOLGOZZ
Lépésenként haladsz. Minden körben kapsz egy pillanatképet az oldalról
(cím, URL, kattintható elemek, űrlapmezők, friss hibák), és PONTOSAN EGY
műveletet adsz vissza JSON-ban. Legyél célirányos: eredj egy nyom után,
ne kattints véletlenszerűen. Ha találtál valamit, JELENTSD, majd menj tovább.

# VÁLASZ-FORMÁTUM (csak ez, semmi más szöveg, semmi markdown-keret)
{"gondolat":"1 mondat, mit próbálsz és miért","muvelet":{...}}

Lehetséges műveletek:
{"tipus":"megnyit","url":"/utvonal"}
{"tipus":"kattint","valaszto":"CSS vagy szoveg=..."}
{"tipus":"beir","valaszto":"CSS","ertek":"szöveg"}
{"tipus":"billentyu","billentyu":"Enter|Escape|Tab"}
{"tipus":"vissza"}
{"tipus":"frissit"}
{"tipus":"var","ms":1500}
{"tipus":"talalat","sulyossag":"kritikus|magas|kozepes|alacsony","cim":"rövid cím","leiras":"mit csináltál, mi történt, mi lett volna a helyes","reprodukalas":"1. … 2. … 3. …"}
{"tipus":"vege","osszegzes":"miért hagyod abba"}

A "valaszto" lehet CSS-szelektor (pl. "button.btn") vagy "szoveg=Belépés"
alakú szöveg-egyezés (a látható feliratra illeszkedik).`;

// =====================================================================
//  LLM-hívás (Claude vagy Gemini, natív fetch — nincs új függőség)
// =====================================================================

const ANTHROPIC_KEY = process.env.ANTHROPIC_API_KEY;
const GEMINI_KEY = process.env.GEMINI_API_KEY;
const CLAUDE_MODEL = process.env.CLAUDE_MODEL || 'claude-sonnet-5';
const GEMINI_MODEL = process.env.GEMINI_MODEL || 'gemini-2.5-flash';

if (!ANTHROPIC_KEY && !GEMINI_KEY) {
  console.error(
    'Hiányzik az LLM-kulcs. Állítsd be az egyiket:\n' +
    '  ANTHROPIC_API_KEY=...   (Claude — ajánlott)\n' +
    '  GEMINI_API_KEY=...      (Gemini — a projektben már fizetett)',
  );
  process.exit(1);
}

async function llmHivas(elozmeny) {
  if (ANTHROPIC_KEY) {
    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-api-key': ANTHROPIC_KEY,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: CLAUDE_MODEL,
        max_tokens: 1024,
        system: RENDSZER_PROMPT,
        messages: elozmeny,
      }),
    });
    if (!res.ok) throw new Error(`Anthropic ${res.status}: ${(await res.text()).slice(0, 300)}`);
    const data = await res.json();
    return (data.content || []).filter((c) => c.type === 'text').map((c) => c.text).join('');
  }

  const res = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent?key=${GEMINI_KEY}`,
    {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        systemInstruction: { parts: [{ text: RENDSZER_PROMPT }] },
        contents: elozmeny.map((m) => ({
          role: m.role === 'assistant' ? 'model' : 'user',
          parts: [{ text: m.content }],
        })),
        generationConfig: { maxOutputTokens: 1024, temperature: 0.8 },
      }),
    },
  );
  if (!res.ok) throw new Error(`Gemini ${res.status}: ${(await res.text()).slice(0, 300)}`);
  const data = await res.json();
  return data.candidates?.[0]?.content?.parts?.map((p) => p.text).join('') || '';
}

/** A modell néha ```json kerettel válaszol — kihámozzuk. */
function jsonKihamoz(szoveg) {
  const tiszta = szoveg.replace(/```(?:json)?/g, '').trim();
  const kezd = tiszta.indexOf('{');
  const veg = tiszta.lastIndexOf('}');
  if (kezd === -1 || veg === -1) throw new Error(`Nem JSON válasz: ${szoveg.slice(0, 200)}`);
  return JSON.parse(tiszta.slice(kezd, veg + 1));
}

// =====================================================================
//  Passzív műszerezés — ez a rész LLM NÉLKÜL is talál hibát
// =====================================================================

function muszerezes(page, tunetek) {
  page.on('console', (msg) => {
    if (msg.type() !== 'error') return;
    const szoveg = msg.text();
    // A böngésző saját zaja nem a mi hibánk
    if (/favicon|ERR_INTERNET_DISCONNECTED|Download the React DevTools/i.test(szoveg)) return;
    tunetek.push({ fajta: 'js-hiba', url: page.url(), reszlet: szoveg.slice(0, 400) });
  });

  page.on('pageerror', (err) => {
    tunetek.push({ fajta: 'kezeletlen-kivetel', url: page.url(), reszlet: String(err).slice(0, 400) });
  });

  page.on('response', (res) => {
    const status = res.status();
    if (status >= 500) {
      tunetek.push({ fajta: 'szerverhiba', url: res.url(), reszlet: `HTTP ${status}` });
    }
  });

  page.on('requestfailed', (req) => {
    const hiba = req.failure()?.errorText || '';
    if (/ERR_ABORTED|net::ERR_FAILED/.test(hiba)) return; // navigáció közbeni megszakítás
    tunetek.push({ fajta: 'elakadt-keres', url: req.url(), reszlet: hiba });
  });
}

// =====================================================================
//  Az oldal pillanatképe a modellnek
// =====================================================================

async function pillanatkep(page) {
  return page.evaluate(() => {
    const lathato = (el) => {
      const r = el.getBoundingClientRect();
      return r.width > 0 && r.height > 0 && getComputedStyle(el).visibility !== 'hidden';
    };
    const rovid = (s) => (s || '').replace(/\s+/g, ' ').trim().slice(0, 70);

    const kattinthato = [...document.querySelectorAll('button, a[href], [role="button"]')]
      .filter(lathato)
      .slice(0, 40)
      .map((el) => {
        const cimke = rovid(el.innerText || el.getAttribute('aria-label') || el.title);
        const hova = el.tagName === 'A' ? ` → ${el.getAttribute('href')}` : '';
        return `- ${el.tagName.toLowerCase()}: "${cimke}"${hova}`;
      });

    const mezok = [...document.querySelectorAll('input, textarea, select')]
      .filter(lathato)
      .slice(0, 30)
      .map((el) => {
        const azon = el.id ? `#${el.id}` : el.name ? `[name="${el.name}"]` : `[placeholder="${el.placeholder}"]`;
        const ertek = el.type === 'checkbox' ? (el.checked ? 'bepipálva' : 'üres') : rovid(el.value);
        return `- ${el.tagName.toLowerCase()}[${el.type || 'text'}] ${azon} placeholder="${rovid(el.placeholder)}" érték="${ertek}"${el.required ? ' KÖTELEZŐ' : ''}`;
      });

    const uzenetek = [...document.querySelectorAll('[role="alert"], .callout, .toast')]
      .filter(lathato).slice(0, 10)
      .map((el) => `- ${rovid(el.innerText)}`);

    return {
      cim: document.title,
      fejlec: rovid(document.querySelector('h1')?.innerText),
      kattinthato: kattinthato.join('\n') || '(nincs)',
      mezok: mezok.join('\n') || '(nincs)',
      uzenetek: uzenetek.join('\n') || '(nincs)',
    };
  });
}

// =====================================================================
//  Műveletek végrehajtása
// =====================================================================

function elemKereso(page, valaszto) {
  if (valaszto.startsWith('szoveg=')) {
    return page.getByText(valaszto.slice(7).trim(), { exact: false }).first();
  }
  return page.locator(valaszto).first();
}

async function vegrehajt(page, muvelet) {
  switch (muvelet.tipus) {
    case 'megnyit': {
      const cel = new URL(muvelet.url, BASE_URL);
      if (new URL(BASE_URL).origin !== cel.origin) {
        return 'ELUTASÍTVA: csak a tesztelt oldalon belül navigálhatsz.';
      }
      await page.goto(cel.toString(), { waitUntil: 'domcontentloaded', timeout: 20000 });
      return `megnyitva: ${cel.pathname}`;
    }
    case 'kattint':
      await elemKereso(page, muvelet.valaszto).click({ timeout: 6000 });
      return `kattintva: ${muvelet.valaszto}`;
    case 'beir':
      await elemKereso(page, muvelet.valaszto).fill(String(muvelet.ertek ?? ''), { timeout: 6000 });
      return `beírva "${muvelet.ertek}" ide: ${muvelet.valaszto}`;
    case 'billentyu':
      await page.keyboard.press(muvelet.billentyu || 'Enter');
      return `billentyű: ${muvelet.billentyu}`;
    case 'vissza':
      await page.goBack({ waitUntil: 'domcontentloaded' });
      return 'vissza';
    case 'frissit':
      await page.reload({ waitUntil: 'domcontentloaded' });
      return 'frissítve';
    case 'var':
      await page.waitForTimeout(Math.min(Number(muvelet.ms) || 1000, 5000));
      return 'vártam';
    default:
      return `ismeretlen művelet: ${muvelet.tipus}`;
  }
}

// =====================================================================
//  Fő hurok
// =====================================================================

async function fut() {
  const talalatok = [];
  const tunetek = [];
  const naplo = [];

  const browser = await chromium.launch({ headless: FEJLEC_NELKUL });
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const page = await ctx.newPage();
  muszerezes(page, tunetek);

  await page.goto(BASE_URL, { waitUntil: 'domcontentloaded' });
  // A süti-banner minden képernyőt eltakarna
  try {
    await page.getByRole('button', { name: /Elfogadom/i }).click({ timeout: 3000 });
  } catch { /* nincs banner */ }

  const elozmeny = [{
    role: 'user',
    content: `Elindultál a ${BASE_URL} oldalon. Kezdd a felderítést.\n` +
      `Összesen ${LEPESEK} lépésed van. Első lépésként nézz körül.`,
  }];

  for (let lepes = 1; lepes <= LEPESEK; lepes += 1) {
    const kep = await pillanatkep(page);
    const ujTunetek = tunetek.splice(0);
    for (const t of ujTunetek) {
      // A műszerezett tünet AKKOR IS találat, ha az LLM nem veszi észre
      talalatok.push({
        sulyossag: t.fajta === 'szerverhiba' ? 'magas' : 'kozepes',
        cim: `Automatikusan észlelt: ${t.fajta}`,
        leiras: `${t.reszlet}\n(URL: ${t.url})`,
        reprodukalas: naplo.slice(-4).join('\n') || '(a felderítés eleje)',
        forras: 'műszer',
      });
    }

    elozmeny.push({
      role: 'user',
      content:
        `## ${lepes}. lépés — az oldal most\n` +
        `URL: ${page.url()}\nCím: ${kep.cim}\nFőcím: ${kep.fejlec}\n\n` +
        `### Kattintható\n${kep.kattinthato}\n\n### Mezők\n${kep.mezok}\n\n` +
        `### Üzenetek a képernyőn\n${kep.uzenetek}\n\n` +
        (ujTunetek.length
          ? `### ⚠ Technikai tünetek az előző művelet óta\n${ujTunetek.map((t) => `- ${t.fajta}: ${t.reszlet}`).join('\n')}\n\n`
          : '') +
        `Add meg a következő műveletet.`,
    });

    let valasz;
    try {
      valasz = await llmHivas(elozmeny);
    } catch (err) {
      console.error(`\n[${lepes}] LLM-hiba: ${err.message}`);
      break;
    }

    let dontes;
    try {
      dontes = jsonKihamoz(valasz);
    } catch (err) {
      elozmeny.push({ role: 'assistant', content: valasz });
      elozmeny.push({ role: 'user', content: 'Csak a megadott JSON-formátumban válaszolj.' });
      continue;
    }
    elozmeny.push({ role: 'assistant', content: JSON.stringify(dontes) });

    const m = dontes.muvelet || {};
    console.log(`[${lepes}/${LEPESEK}] ${dontes.gondolat || ''} → ${m.tipus || '?'}`);

    if (m.tipus === 'vege') {
      naplo.push(`VÉGE: ${m.osszegzes}`);
      break;
    }
    if (m.tipus === 'talalat') {
      talalatok.push({ ...m, forras: 'AI' });
      console.log(`   ⚑ TALÁLAT (${m.sulyossag}): ${m.cim}`);
      elozmeny.push({ role: 'user', content: 'Rögzítettem a találatot. Folytasd a felderítést.' });
      continue;
    }

    let eredmeny;
    try {
      eredmeny = await vegrehajt(page, m);
    } catch (err) {
      eredmeny = `A művelet NEM sikerült: ${String(err.message).split('\n')[0]}`;
    }
    naplo.push(`${lepes}. ${eredmeny}`);
    elozmeny.push({ role: 'user', content: `Eredmény: ${eredmeny}` });

    // Az előzményt nyesegetjük, hogy a token-költség ne szaladjon el
    if (elozmeny.length > 24) elozmeny.splice(1, 6);
  }

  await browser.close();
  jelentestIr(talalatok, naplo);
}

function jelentestIr(talalatok, naplo) {
  const rend = { kritikus: 0, magas: 1, kozepes: 2, alacsony: 3 };
  talalatok.sort((a, b) => (rend[a.sulyossag] ?? 9) - (rend[b.sulyossag] ?? 9));

  const sorok = [
    `# AI felderítő teszt — jelentés`,
    ``,
    `- **Mikor:** ${new Date().toLocaleString('hu-HU')}`,
    `- **Cél:** ${BASE_URL}`,
    `- **Szerep:** ${SZEMELY}`,
    `- **Modell:** ${ANTHROPIC_KEY ? CLAUDE_MODEL : GEMINI_MODEL}`,
    `- **Találatok:** ${talalatok.length}`,
    ``,
    `> ⚠️ Ez FELDERÍTÉS, nem bizonyíték. Minden találatot ellenőrizz kézzel,`,
    `> mielőtt javítanál. Ami valósnak bizonyul, arra írj determinisztikus`,
    `> tesztet — a felderítés nem véd a visszacsúszás ellen, csak megtalálja.`,
    ``,
  ];

  if (!talalatok.length) {
    sorok.push(`Nem talált semmit. Ez nem bizonyítja, hogy nincs hiba —`,
      `próbáld más szereppel (SZEMELY=zavarodott|turelmetlen) vagy több lépéssel.`);
  }

  for (const [i, t] of talalatok.entries()) {
    sorok.push(
      `## ${i + 1}. [${(t.sulyossag || 'ismeretlen').toUpperCase()}] ${t.cim}`,
      ``,
      `*Forrás: ${t.forras === 'műszer' ? 'automatikus műszer' : 'AI megfigyelés'}*`,
      ``,
      t.leiras || '',
      ``,
      `**Reprodukálás:**`,
      '```',
      t.reprodukalas || '(nincs)',
      '```',
      ``,
    );
  }

  sorok.push(`---`, ``, `## A munkamenet lépései`, '```', ...naplo, '```');

  fs.writeFileSync(KIMENET, sorok.join('\n'), 'utf8');
  console.log(`\n✔ Jelentés: ${KIMENET} (${talalatok.length} találat)`);
}

fut().catch((err) => {
  console.error('Végzetes hiba:', err);
  process.exit(1);
});
