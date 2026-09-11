// CORS-origin lista az env-ből (2026-09-11, teljes audit C1).
//
// Eddig: ha a CORS_ORIGIN hiányzott, a szerver csendben MINDEN origint
// engedett (`origin: true`) — élesben ez egy elfelejtett env-változóval
// nyitott CORS-t jelentett volna, riasztás nélkül. A viselkedés marad
// (egy hiányzó env ne döntse le az API-t), de élesben HANGOSAN jelezzük.
function corsOriginsFromEnv(env = process.env, nodeEnv = process.env.NODE_ENV) {
  const origins = String(env.CORS_ORIGIN || '').split(',').map((s) => s.trim()).filter(Boolean);
  let warning = null;
  if (origins.length === 0 && nodeEnv === 'production') {
    warning = '[cors] ÉLES futás CORS_ORIGIN nélkül — MINDEN origin engedett. Állítsd be a Railway env-ben (pl. https://www.gofuvar.hu,https://gofuvar.hu).';
  }
  return { origins, warning };
}

module.exports = { corsOriginsFromEnv };
