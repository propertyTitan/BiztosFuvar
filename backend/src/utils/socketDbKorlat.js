// Socket-eredetű DB-munka folyamat-szintű korlátja (2026-09-28, audit P1).
//
// ⚠️ MIÉRT: a globális HTTP rate limit (index.js) a websocket-eseményekre nem
// hat, az `io.use` csak a JWT-t ellenőrzi. Egyetlen hitelesített socket
// másodpercenként több ezer `job:join`-t küldhetett (akár véletlen UUID-kkal),
// és mindegyikből egy lekérdezés lett a 30 kapcsolatos poolon — korlát nélkül
// sorba állva. A `connectionTimeoutMillis` (5 s) lejártával ekkor MINDEN
// DB-kötött REST-kérés „timeout exceeded when trying to connect" → 500 lett:
// egy socket az egész API-t leállította.
//
// Ez a modul az OSZTÁLYT zárja: a realtime réteg MINDEN lekérdezése
// (handshake, szoba-belépés, aktivitás-mérés) ezen megy át. Egyszerre
// legfeljebb `maxInFlight` fut — a pool kis szelete —, a várólista korlátos,
// ami nem fér bele, CSENDBEN eldobódik (a hívó hibaága „nincs belépés" /
// „vendég" / „nincs mérés"). A REST-oldal így mindig kap kapcsolatot,
// bármennyi socket-esemény érkezik.

// Eldobáskor mindig ugyanazt a hibát adjuk: egy áradatban ne gyártsunk
// eseményenként új Error-t (stack-trace) — a hívók úgyis csak elnyelik.
const ELDOBVA = new Error('socket DB-korlát: eldobva');
ELDOBVA.code = 'SOCKET_DB_ELDOBVA';

/**
 * @param {{ maxInFlight: number, maxQueue: number }} opts
 * @returns {{ run: Function, allapot: Function }}
 */
function createSocketDbKorlat({ maxInFlight, maxQueue }) {
  let fut = 0;
  let eldobott = 0;
  // A handshake előnyt kap: egy szoba-belépési áradat ne tegye vendéggé a
  // jogosan csatlakozókat (értesítés, chat élő frissítése nélkül maradnának).
  let magas = [];
  let normal = [];

  const sorHossz = () => magas.length + normal.length;
  const elutasit = (t) => { eldobott += 1; t.reject(ELDOBVA); };
  const okafogyott = (t) => !!t.ervenyes && !t.ervenyes();

  // Az időközben okafogyottá vált tételek (bontott socket, visszavont
  // belépés) kiesnek, mielőtt telinek nyilvánítanánk a sort.
  function takarit() {
    const marad = (t) => {
      if (!okafogyott(t)) return true;
      elutasit(t);
      return false;
    };
    magas = magas.filter(marad);
    normal = normal.filter(marad);
  }

  function pumpal() {
    while (fut < maxInFlight && sorHossz()) {
      const t = magas.length ? magas.shift() : normal.shift();
      if (okafogyott(t)) { elutasit(t); continue; }
      fut += 1;
      // A `then` miatt a szinkron kivétel is a hívó hibaágán landol.
      Promise.resolve().then(t.fn).then(t.resolve, t.reject).finally(() => {
        fut -= 1;
        pumpal();
      });
    }
  }

  /**
   * @param {() => Promise<any>} fn — a lekérdezés (csak akkor fut, ha sorra kerül)
   * @param {object} [opciok]
   * @param {() => boolean} [opciok.ervenyes] — sorra kerüléskor kell-e még
   * @param {boolean} [opciok.elsobbseg] — handshake: a sor elejére, és telt
   *   sornál a legfrissebb normál tételt szorítja ki
   * @param {boolean} [opciok.elhagyhato] — mérés jellegű írás: terhelés alatt
   *   (már negyedig telt sornál) sorba sem kerül
   */
  function run(fn, { ervenyes, elsobbseg = false, elhagyhato = false } = {}) {
    return new Promise((resolve, reject) => {
      const t = { fn, ervenyes, resolve, reject };
      if (elhagyhato && sorHossz() >= Math.max(1, Math.floor(maxQueue / 4))) {
        elutasit(t);
        return;
      }
      if (sorHossz() >= maxQueue) takarit();
      if (sorHossz() >= maxQueue) {
        if (!elsobbseg || !normal.length) { elutasit(t); return; }
        elutasit(normal.pop());
      }
      (elsobbseg ? magas : normal).push(t);
      pumpal();
    });
  }

  return { run, allapot: () => ({ fut, sor: sorHossz(), eldobott }) };
}

/**
 * Socketenkénti token-vödör: `kapacitas` azonnali löket, utána
 * `mpenkent` darab/másodperc. Igazat ad, ha az esemény belefér.
 */
function createKeret({ kapacitas, mpenkent }) {
  let tokenek = kapacitas;
  let utolso = Date.now();
  return () => {
    const most = Date.now();
    tokenek = Math.min(kapacitas, tokenek + ((most - utolso) / 1000) * mpenkent);
    utolso = most;
    if (tokenek < 1) return false;
    tokenek -= 1;
    return true;
  };
}

module.exports = { createSocketDbKorlat, createKeret, ELDOBVA };
