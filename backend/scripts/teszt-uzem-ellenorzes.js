// =====================================================================
//  TESZT-ÜZEM ELLENŐRZÉS az ÉLES rendszeren
//
//  Megmondja, hogy az `ALLOW_STUB_PAYMENTS` teszt-üzem BE vagy KI van-e
//  kapcsolva a Railway-en — anélkül, hogy be kellene lépned a felületre.
//
//  KÉT HELYZETBEN KELL:
//
//   1. MOST (tesztelés alatt): bekapcsoltad-e ténylegesen? Ha nem érvényesült
//      az env-változó, a tesztelő továbbra sem jut túl a fizetésen.
//
//   2. ⚠️⚠️ LAUNCH ELŐTT: KIKAPCSOLTAD-E? Ha bent marad, BÁRKI fizetés nélkül
//      „fizetettnek" jelölheti a saját fuvarát, és ingyen megkapja a
//      kontaktot — a platform EGYETLEN bevétele kerülhető meg.
//
//  Használat:  cd backend && node scripts/teszt-uzem-ellenorzes.js
//
//  ⚠️ Létrehoz egy [TESZT] jelölésű ideiglenes fiókot (a jelzőt csak
//  bejelentkezve adja ki a szerver), majd TÖRLI is. Ha a törlés bármiért nem
//  sikerülne, a szkript kiírja a fiók e-mail címét, hogy kézzel törölhesd.
// =====================================================================
const fs = require('fs');
const path = require('path');
const { Client } = require('pg');

const API = process.env.API_BASE || 'https://api.gofuvar.hu';

const envUt = path.join(__dirname, '..', '.env');
const envRaw = fs.existsSync(envUt) ? fs.readFileSync(envUt, 'utf8') : '';
const DATABASE_URL = (envRaw.match(/^DATABASE_URL=(.+)$/m) || [])[1];

const email = `teszt-uzem-ellenorzes+${Date.now()}@gofuvar.hu`;
const jelszo = 'EllenorzoTeszt123!';

async function hivas(ut, { method = 'GET', token, body } = {}) {
  const res = await fetch(`${API}${ut}`, {
    method,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const szoveg = await res.text();
  let adat = null;
  try { adat = JSON.parse(szoveg); } catch { /* nem JSON */ }
  return { status: res.status, adat, szoveg };
}

(async () => {
  console.log(`\n🔎 Teszt-üzem ellenőrzés — ${API}\n`);

  const health = await hivas('/health');
  if (health.status !== 200) {
    console.error(`❌ Az API nem válaszol (HTTP ${health.status}). Nézd meg a Railway-t.`);
    process.exit(2);
  }

  const reg = await hivas('/auth/register', {
    method: 'POST',
    body: {
      email,
      password: jelszo,
      full_name: '[TESZT] Teszt-üzem ellenőrzés',
      phone: '+36 20 000 0000',
    },
  });
  if (reg.status >= 400 || !reg.adat?.token) {
    console.error(`❌ Nem sikerült ideiglenes fiókot létrehozni (HTTP ${reg.status}).`);
    console.error(reg.szoveg.slice(0, 300));
    process.exit(2);
  }

  let kilepesiKod = 0;
  try {
    const me = await hivas('/auth/me', { token: reg.adat.token });
    if (me.status !== 200) {
      console.error(`❌ A /auth/me nem válaszolt (HTTP ${me.status}).`);
      process.exitCode = 2;
    } else if (me.adat.payment_test_mode === true) {
      console.log('🚨 TESZT-ÜZEM: BEKAPCSOLVA (ALLOW_STUB_PAYMENTS=true)\n');
      console.log('   A tesztelő túljut a fizetésen — a fizetés utáni szakasz tesztelhető.');
      console.log('   A fizetési kártyán sárga „TESZT FIZETÉSI MÓD" sáv látszik.\n');
      console.log('   ⚠️ LAUNCH ELŐTT EZT TÖRÖLNI KELL a Railway env-ből, különben');
      console.log('      bárki fizetés nélkül megkaphatja a kontaktot.');
      kilepesiKod = 10; // megkülönböztethető kód, ha szkriptből hívnád
    } else if (me.adat.payment_test_mode === false) {
      console.log('✅ TESZT-ÜZEM: KIKAPCSOLVA\n');
      console.log('   A kézi fizetés-nyugtázás zárva — fizetés nélkül senki nem juthat');
      console.log('   kontakthoz. Ez a LAUNCH-KÉPES állapot.\n');
      console.log('   ⚠️ Ha most azt VÁRTAD, hogy be van kapcsolva: az env-változó nem');
      console.log('      érvényesült. Ellenőrizd, hogy a neve pontosan');
      console.log('      ALLOW_STUB_PAYMENTS, az értéke pontosan true (kisbetűvel),');
      console.log('      és hogy a BACKEND service-hez vetted fel — majd várd meg az');
      console.log('      újraindulást.');
    } else {
      console.error('❓ A szerver nem adott `payment_test_mode` mezőt.');
      console.error('   Valószínűleg a régi kód fut még — várd meg a deploy végét.');
      process.exitCode = 2;
    }
  } finally {
    // Takarítás: az ideiglenes fiók törlése közvetlenül a DB-ből.
    let torolve = false;
    if (DATABASE_URL) {
      const db = new Client({ connectionString: DATABASE_URL });
      try {
        await db.connect();
        const r = await db.query('DELETE FROM users WHERE email = $1', [email]);
        torolve = r.rowCount > 0;
      } catch (e) {
        console.warn(`\n⚠️ A takarítás nem sikerült: ${e.message}`);
      } finally {
        await db.end().catch(() => {});
      }
    }
    if (torolve) {
      console.log('\n🧹 Az ideiglenes fiók törölve.');
    } else {
      console.log(`\n⚠️ AZ IDEIGLENES FIÓK BENT MARADT — töröld kézzel: ${email}`);
    }
  }

  if (kilepesiKod) process.exitCode = kilepesiKod;
})();
