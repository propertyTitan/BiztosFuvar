// Árfolyam szolgáltatás — MNB / EKB referencia árfolyam.
//
// A GoFuvar a licitálás pillanatában "befagyasztja" az EUR/HUF
// árfolyamot, hogy se a feladó, se a sofőr ne veszítsen a
// devizaingadozáson a licit és a kifizetés között.
//
// Az árfolyamot naponta egyszer frissítjük az EKB API-ból (ingyenes,
// nem kell kulcs), és in-memory cache-eljük. Ha az API nem elérhető,
// a legutolsó ismert árfolyamot használjuk.

const ECB_DAILY_URL = 'https://data-api.ecb.europa.eu/service/data/EXR/D.HUF.EUR.SP00.A?format=csvdata&lastNObservations=1';

// In-memory cache
let cachedRate = {
  eurHuf: 400, // fallback ha az ECB nem elérhető
  fetchedAt: null,
  source: 'fallback',
};

const CACHE_TTL_MS = 4 * 60 * 60 * 1000; // 4 óra

/**
 * EUR/HUF árfolyam lekérdezése (cache-elt, naponta frissül).
 * @returns {Promise<{rate: number, fetchedAt: string, source: string}>}
 */
async function getEurHufRate() {
  // Ha a cache friss (<4 óra), azt adjuk vissza
  if (cachedRate.fetchedAt && (Date.now() - new Date(cachedRate.fetchedAt).getTime()) < CACHE_TTL_MS) {
    return { rate: cachedRate.eurHuf, fetchedAt: cachedRate.fetchedAt, source: cachedRate.source };
  }

  try {
    // EKB CSV API — az utolsó napon érvényes EUR/HUF
    const res = await fetch(ECB_DAILY_URL, { signal: AbortSignal.timeout(5000) });
    if (!res.ok) throw new Error(`ECB HTTP ${res.status}`);
    const csv = await res.text();

    // A CSV utolsó sorában van az árfolyam — a "OBS_VALUE" oszlop
    const lines = csv.trim().split('\n');
    const header = lines[0].split(',');
    const lastLine = lines[lines.length - 1].split(',');
    const valueIdx = header.indexOf('OBS_VALUE');
    const rate = parseFloat(lastLine[valueIdx]);

    if (!rate || isNaN(rate) || rate < 100 || rate > 800) {
      throw new Error(`Érvénytelen árfolyam: ${rate}`);
    }

    cachedRate = {
      eurHuf: rate,
      fetchedAt: new Date().toISOString(),
      source: 'ecb',
    };
    console.log(`[exchange] EUR/HUF frissítve: ${rate} (ECB)`);
    return { rate, fetchedAt: cachedRate.fetchedAt, source: 'ecb' };
  } catch (err) {
    console.warn('[exchange] EKB lekérdezés sikertelen:', err.message, '→ cache használata');
    return { rate: cachedRate.eurHuf, fetchedAt: cachedRate.fetchedAt || new Date().toISOString(), source: cachedRate.source || 'fallback' };
  }
}

/**
 * Összeg átváltása EUR → HUF (tájékoztató jellegű).
 * NEM a tényleges tranzakciós árfolyam — a Barion a sajátját használja.
 * Ez a licit megjelenítéséhez és az árfolyam "befagyasztásához" kell.
 */
async function convertEurToHuf(eurAmount) {
  const { rate, fetchedAt, source } = await getEurHufRate();
  return {
    eurAmount,
    hufAmount: Math.round(eurAmount * rate),
    rate,
    rateDate: fetchedAt,
    rateSource: source,
  };
}

/**
 * Összeg átváltása HUF → EUR (tájékoztató jellegű).
 */
async function convertHufToEur(hufAmount) {
  const { rate, fetchedAt, source } = await getEurHufRate();
  return {
    hufAmount,
    eurAmount: Math.round((hufAmount / rate) * 100) / 100, // 2 tizedes
    rate,
    rateDate: fetchedAt,
    rateSource: source,
  };
}

/**
 * Árfolyam "befagyasztása" — a licit/foglalás pillanatában tárolt
 * árfolyam adatot ad vissza, amit a DB-be menthetünk.
 *
 * @returns {{ rate: number, frozenAt: string, source: string }}
 */
async function freezeExchangeRate() {
  const { rate, fetchedAt, source } = await getEurHufRate();
  return {
    rate,
    frozenAt: new Date().toISOString(),
    rateDate: fetchedAt,
    source,
  };
}

module.exports = {
  getEurHufRate,
  convertEurToHuf,
  convertHufToEur,
  freezeExchangeRate,
};
