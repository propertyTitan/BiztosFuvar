// =====================================================================
//  Link-előnézet — "Hozasd el" funkcióhoz.
//
//  A feladó bemásol egy hirdetés-linket (Jófogás / Vatera / Facebook
//  Marketplace), mi pedig a publikus Open Graph metaadatból (og:title,
//  og:image) előnézetet adunk, hogy a fuvarfeladás előtöltődhessen.
//
//  NEM scrape-elünk strukturált adatot (ToS + törékeny). Csak az OG
//  preview-t olvassuk — ugyanaz, amit minden chat-app csinál linknél.
//
//  Biztonság (SSRF): szigorú HOSZT-engedélylista, kézi átirányítás-
//  ellenőrzés, időkorlát és méret-korlát. Csak ismert marketplace-domének.
// =====================================================================

const express = require('express');
const router = express.Router();

// Csak ezek a hosztok engedélyezettek (SSRF ellen).
// Kizárólag olyan oldalak, amik megbízható Open Graph előnézetet adnak
// (cím + kép). A login-/bot-falas oldalakat (Facebook, Mömax, Möbelix)
// szándékosan NEM tesszük be, mert ott úgyis csak a link maradna.
const ALLOWED_HOSTS = new Set([
  // Apróhirdetés
  'jofogas.hu', 'www.jofogas.hu',
  // Bútor / barkács áruházak
  'ikea.com', 'www.ikea.com',
  'obi.hu', 'www.obi.hu',
  'praktiker.hu', 'www.praktiker.hu',
]);

function sourceName(host) {
  if (host.includes('jofogas')) return 'Jófogás';
  if (host.includes('ikea')) return 'IKEA';
  if (host.includes('obi')) return 'OBI';
  if (host.includes('praktiker')) return 'Praktiker';
  return 'hirdetés';
}

function isAllowed(urlStr) {
  try {
    const u = new URL(urlStr);
    if (u.protocol !== 'https:' && u.protocol !== 'http:') return null;
    if (!ALLOWED_HOSTS.has(u.hostname.toLowerCase())) return null;
    return u;
  } catch {
    return null;
  }
}

// Egy OG/meta tag tartalmának kinyerése (attribútum-sorrend toleráns).
function metaContent(html, key) {
  // property="og:title" ... content="..."  VAGY  content="..." ... property="og:title"
  const patterns = [
    new RegExp(`<meta[^>]+(?:property|name)=["']${key}["'][^>]*content=["']([^"']*)["']`, 'i'),
    new RegExp(`<meta[^>]+content=["']([^"']*)["'][^>]*(?:property|name)=["']${key}["']`, 'i'),
  ];
  for (const re of patterns) {
    const m = html.match(re);
    if (m && m[1]) return decodeEntities(m[1].trim());
  }
  return null;
}

function decodeEntities(s) {
  return s
    .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&#x27;/g, "'");
}

// GET /link-preview?url=...
router.get('/link-preview', async (req, res) => {
  const u = isAllowed(req.query.url);
  if (!u) {
    return res.status(400).json({
      error: 'Ezt a linket nem ismerjük fel. Támogatott: IKEA, OBI, Praktiker, Jófogás.',
      code: 'UNSUPPORTED_LINK',
    });
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 6000);
  try {
    const resp = await fetch(u.toString(), {
      redirect: 'follow',
      signal: controller.signal,
      headers: {
        // Sok oldal csak "böngészős" UA-ra ad OG-t
        'User-Agent': 'Mozilla/5.0 (compatible; GoFuvarBot/1.0; +https://gofuvar.hu)',
        'Accept': 'text/html',
      },
    });

    // Átirányítás-ellenőrzés: a végső hoszt is engedélyezett legyen
    try {
      const finalHost = new URL(resp.url).hostname.toLowerCase();
      if (!ALLOWED_HOSTS.has(finalHost)) {
        return res.json({ ok: false, source: sourceName(u.hostname), url: u.toString() });
      }
    } catch {}

    if (!resp.ok) {
      return res.json({ ok: false, source: sourceName(u.hostname), url: u.toString() });
    }

    // Csak az első ~256 KB-ot olvassuk (az OG tagek a <head>-ben vannak)
    const reader = resp.body?.getReader?.();
    let html = '';
    if (reader) {
      const decoder = new TextDecoder();
      let total = 0;
      const MAX = 256 * 1024;
      while (total < MAX) {
        const { done, value } = await reader.read();
        if (done) break;
        total += value.length;
        html += decoder.decode(value, { stream: true });
        if (/<\/head>/i.test(html)) break; // a head végén minden OG megvan
      }
      try { await reader.cancel(); } catch {}
    } else {
      html = (await resp.text()).slice(0, 256 * 1024);
    }

    const title = metaContent(html, 'og:title')
      || (html.match(/<title[^>]*>([^<]*)<\/title>/i)?.[1] || '').trim() || null;
    const image = metaContent(html, 'og:image');
    const description = metaContent(html, 'og:description');

    res.json({
      ok: Boolean(title || image),
      source: sourceName(u.hostname),
      url: u.toString(),
      title: title ? decodeEntities(title) : null,
      image: image || null,
      description: description || null,
    });
  } catch {
    // timeout / hálózati hiba / login-fal (pl. FB) → graceful: csak a link
    res.json({ ok: false, source: sourceName(u.hostname), url: u.toString() });
  } finally {
    clearTimeout(timeout);
  }
});

module.exports = router;
