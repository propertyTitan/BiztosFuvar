// Sitemap a publikus (bejelentkezés nélkül elérhető) oldalakról.
// FONTOS: a robots.txt élesedésig Disallow: / — a sitemap már most helyes,
// launchkor csak a robots.txt-t kell Allow-ra váltani (CLAUDE.md 9. szakasz).
import type { MetadataRoute } from 'next';
import { landingLinks } from '@/lib/landings';

const BASE = 'https://gofuvar.hu';

export default function sitemap(): MetadataRoute.Sitemap {
  const now = new Date();
  const core: MetadataRoute.Sitemap = [
    { url: `${BASE}/`, lastModified: now, changeFrequency: 'daily', priority: 1 },
    { url: `${BASE}/bejelentkezes`, lastModified: now, changeFrequency: 'monthly', priority: 0.8 },
    { url: `${BASE}/hozasd-el`, lastModified: now, changeFrequency: 'monthly', priority: 0.8 },
    { url: `${BASE}/aszf`, lastModified: now, changeFrequency: 'monthly', priority: 0.3 },
    { url: `${BASE}/adatkezeles`, lastModified: now, changeFrequency: 'monthly', priority: 0.3 },
  ];
  // Landing-oldalak (útvonal / célközönség / használati eset) — SEO belépők.
  const landings: MetadataRoute.Sitemap = landingLinks().map((l) => ({
    url: `${BASE}${l.href}`,
    lastModified: now,
    changeFrequency: 'weekly',
    priority: 0.7,
  }));
  return [...core, ...landings];
}
