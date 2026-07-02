// Sitemap a publikus (bejelentkezés nélkül elérhető) oldalakról.
// FONTOS: a robots.txt élesedésig Disallow: / — a sitemap már most helyes,
// launchkor csak a robots.txt-t kell Allow-ra váltani (CLAUDE.md 9. szakasz).
import type { MetadataRoute } from 'next';

const BASE = 'https://gofuvar.hu';

export default function sitemap(): MetadataRoute.Sitemap {
  const now = new Date();
  return [
    { url: `${BASE}/`, lastModified: now, changeFrequency: 'daily', priority: 1 },
    { url: `${BASE}/bejelentkezes`, lastModified: now, changeFrequency: 'monthly', priority: 0.8 },
    { url: `${BASE}/hozasd-el`, lastModified: now, changeFrequency: 'monthly', priority: 0.8 },
    { url: `${BASE}/aszf`, lastModified: now, changeFrequency: 'monthly', priority: 0.3 },
    { url: `${BASE}/adatkezeles`, lastModified: now, changeFrequency: 'monthly', priority: 0.3 },
  ];
}
