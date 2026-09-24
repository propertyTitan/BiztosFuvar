// Sitemap a publikus (bejelentkezés nélkül elérhető) oldalakról.
// FONTOS: a robots.txt élesedésig Disallow: / — a sitemap már most helyes,
// launchkor csak a robots.txt-t kell Allow-ra váltani (CLAUDE.md 9. szakasz).
import type { MetadataRoute } from 'next';
import { landingLinks } from '@/lib/landings';

const BASE = 'https://www.gofuvar.hu';

export default function sitemap(): MetadataRoute.Sitemap {
  // Nem „ma” (az minden generáláskor friss módosítást hazudott — Codex P2-03),
  // hanem az utolsó érdemi tartalom-változás dátuma; szövegváltozásnál frissítendő.
  const now = new Date('2026-09-11');
  const hozasdUpdated = new Date('2026-09-24');
  const core: MetadataRoute.Sitemap = [
    { url: `${BASE}/`, lastModified: hozasdUpdated, changeFrequency: 'daily', priority: 1 },
    { url: `${BASE}/bejelentkezes`, lastModified: now, changeFrequency: 'monthly', priority: 0.8 },
    { url: `${BASE}/hozasd-el`, lastModified: hozasdUpdated, changeFrequency: 'monthly', priority: 0.8 },
    { url: `${BASE}/hozasd-el/butor`, lastModified: hozasdUpdated, changeFrequency: 'monthly', priority: 0.7 },
    { url: `${BASE}/aszf`, lastModified: now, changeFrequency: 'monthly', priority: 0.3 },
    { url: `${BASE}/adatkezeles`, lastModified: hozasdUpdated, changeFrequency: 'monthly', priority: 0.3 },
  ];
  // Landing-oldalak (útvonal / célközönség / használati eset) — SEO belépők.
  const landings: MetadataRoute.Sitemap = landingLinks().map((l) => ({
    url: `${BASE}${l.href}`,
    lastModified: ['/butorszallitas', '/ikea-behozatal'].includes(l.href) ? hozasdUpdated : now,
    changeFrequency: 'weekly',
    priority: 0.7,
  }));
  return [...core, ...landings];
}
