// =====================================================================
//  A KERESKEDŐ (üzemeltető) ADATAI — egy forrásból
//
//  A CIB banki átvételi teszt kötelezően nézi: „Kötelezően feltüntetendő
//  továbbá a kereskedő elérhetősége (adószám, székhely, telefon és e-mail),
//  valamint az Általános Szerződési Feltételek […]". A lábléc és a
//  /bankkartyas-fizetes tájékoztató ebből rajzol, hogy a kettő ne csúszhasson
//  szét. (Az ÁSZF és az adatkezelési tájékoztató a saját, jogi szövegében
//  tartalmazza ugyanezt — azokhoz itt nem nyúlunk.)
// =====================================================================
export const KERESKEDO = {
  teljesNev: 'Tiszta Hód Korlátolt Felelősségű Társaság',
  rovidNev: 'Tiszta Hód Kft.',
  szekhely: '6800 Hódmezővásárhely, Szántó Kovács János utca 144.',
  orszag: 'Magyarország',
  cegjegyzekszam: '06-09-020646',
  adoszam: '24750792-2-06',
  email: 'info@gofuvar.hu',
  panaszEmail: 'panasz@gofuvar.hu',
  telefon: '+36 20 397 9223',
  telefonHref: 'tel:+36203979223',
} as const;
