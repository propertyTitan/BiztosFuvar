// A követő-oldal SOHA nem indexelhető.
//
// ⚠️ 2026-08-10 (adatáramlási audit, launch-kapu tétel): az oldal a díj
// kifizetése után kiírja a 6 jegyű ÁTVÉTELI PIN-t és a szállító
// telefonszámát. A `robots.txt` ma még `Disallow: /`, de a launchkor
// `Allow: /`-ra vált — attól a pillanattól ez az oldal indexelhető lenne,
// ha a token bármilyen úton (Referer, megosztott link, sitemap) kikerül.
// Az oldal-szintű noindex a robots.txt-től FÜGGETLENÜL véd.
import type { Metadata } from 'next';

export const metadata: Metadata = {
  robots: { index: false, follow: false, nocache: true },
};

export default function NyomonKovetesLayout({ children }: { children: React.ReactNode }) {
  return children;
}
