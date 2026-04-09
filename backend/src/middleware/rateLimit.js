// Egyszerű, függőség-mentes fixed-window rate limiter middleware.
//
// Minden limit egy "vödröt" kap: kulcs alapján számoljuk hány hívás történt
// az aktuális időablakban. Ha túlmegy a `max` számon, 429-cel visszadobjuk.
// Az ablak letelte után a számláló automatikusan reset-elődik.
//
// A tárolás in-memory Map — ha többgépes élesedésbe kerül a backend, ide
// Redis-t kellene bekötni, de egy node process esetén ez tökéletesen
// elegendő és cseppet sem lassítja a válaszidőket.
//
// Használat:
//   const { createRateLimit } = require('./middleware/rateLimit');
//   router.post('/login',
//     createRateLimit({ windowMs: 60_000, max: 5, keyBy: 'ip',
//                       message: 'Túl sok belépési kísérlet. Várj 1 percet.' }),
//     handler);

const store = new Map();

// Időszakos takarítás, hogy a Map ne nőjjön a végtelenségig. Percenként
// lefut és eldobja a már lejárt bejegyzéseket. Az `unref()` biztosítja,
// hogy a timer ne akadályozza meg a process kilépését tesztelés közben.
const cleanup = setInterval(() => {
  const now = Date.now();
  for (const [k, v] of store) {
    if (v.resetAt <= now) store.delete(k);
  }
}, 60_000);
if (cleanup.unref) cleanup.unref();

/**
 * @param {object} opts
 * @param {number} opts.windowMs – idő-ablak milliszekundumban
 * @param {number} opts.max – a max hívás szám az időablakon belül
 * @param {'ip'|'user'|'ip+user'} [opts.keyBy='ip'] – melyik kulcs alapján korlátozunk
 * @param {string} [opts.message] – a 429-es válaszban levő hibaüzenet
 * @param {string} [opts.name] – log / header prefix (debug célokra)
 */
function createRateLimit({
  windowMs,
  max,
  keyBy = 'ip',
  message = 'Túl sok kérés. Kérlek várj egy percet.',
  name = 'rl',
}) {
  return function rateLimitMiddleware(req, res, next) {
    // Kulcs összeállítása
    const ip =
      req.headers['x-forwarded-for']?.toString().split(',')[0].trim() ||
      req.socket?.remoteAddress ||
      'unknown';
    const userId = req.user?.sub || 'anon';
    let key;
    if (keyBy === 'user') key = `${name}:user:${userId}`;
    else if (keyBy === 'ip+user') key = `${name}:ipuser:${ip}:${userId}`;
    else key = `${name}:ip:${ip}`;

    const now = Date.now();
    let entry = store.get(key);
    if (!entry || entry.resetAt <= now) {
      entry = { count: 0, resetAt: now + windowMs };
      store.set(key, entry);
    }
    entry.count += 1;

    // Rate limit header-ök — segítik a klienst, hogy tudja mennyi maradt
    const remaining = Math.max(0, max - entry.count);
    const retryAfterSec = Math.max(1, Math.ceil((entry.resetAt - now) / 1000));
    res.setHeader('X-RateLimit-Limit', String(max));
    res.setHeader('X-RateLimit-Remaining', String(remaining));
    res.setHeader('X-RateLimit-Reset', String(Math.ceil(entry.resetAt / 1000)));

    if (entry.count > max) {
      res.setHeader('Retry-After', String(retryAfterSec));
      return res.status(429).json({
        error: message,
        retry_after_seconds: retryAfterSec,
      });
    }
    next();
  };
}

// Pre-definiált limitek a gyakori use case-ekre.
const loginRateLimit = createRateLimit({
  windowMs: 60_000,
  max: 10,
  keyBy: 'ip',
  name: 'login',
  message: 'Túl sok belépési kísérlet. Kérlek várj egy percet.',
});

const registerRateLimit = createRateLimit({
  windowMs: 60 * 60 * 1000, // 1 óra
  max: 5,
  keyBy: 'ip',
  name: 'register',
  message: 'Óránként maximum 5 új fiókot lehet regisztrálni egy IP-ről.',
});

const writeRateLimit = createRateLimit({
  windowMs: 60_000,
  max: 30,
  keyBy: 'user',
  name: 'write',
  message: 'Túl sok művelet. Kérlek várj egy percet, mielőtt folytatod.',
});

const aiChatRateLimit = createRateLimit({
  windowMs: 60_000,
  max: 20,
  keyBy: 'user',
  name: 'ai',
  message: 'A GoFuvar segéddel percenként max 20 üzenetet válthatsz.',
});

const globalRateLimit = createRateLimit({
  windowMs: 60_000,
  max: 300,
  keyBy: 'ip',
  name: 'global',
  message: 'Túl sok kérés érkezett erről az IP-ről.',
});

module.exports = {
  createRateLimit,
  loginRateLimit,
  registerRateLimit,
  writeRateLimit,
  aiChatRateLimit,
  globalRateLimit,
};
