// =====================================================================
//  BANKI (CIB) FELKÉSZÜLÉSI ANYAG — a kártyaelfogadás tárgyalásához
//
//  ⚠️ A TARTALOM NEM ITT VAN, hanem a `shared/bank-felkeszules.json`-ben, és
//  admin-kapus végpontról (`GET /admin/dokumentumok/bank-felkeszules`) jön.
//
//  MIÉRT: az első változatban a szöveg ebben a modulban élt. A kliens-oldali
//  admin-kapu csak a MEGJELENÍTÉST állítja meg — a szöveg maga bekerült a
//  publikus JS-chunkba, és bárki letölthette bejelentkezés nélkül (lemérve a
//  `.next/static/chunks/`-ban). Ugyanaz a mintázat, amit a projekt már
//  többször megtalált: a védelem azon a rétegen épült meg, ahol felfedezték.
//
//  Itt csak a TÍPUSOK és a MEGJELENÍTÉS maradt (a letölthető HTML előállítása)
//  — az nem titok, és ugyanabból az adatból dolgozik, mint a képernyő, hogy a
//  kettő ne csúszhasson szét.
// =====================================================================

export type Blokk =
  | { fajta: 'bekezdes'; szoveg: string }
  | { fajta: 'idezet'; szoveg: string }
  | { fajta: 'lista'; elemek: string[] }
  | { fajta: 'tabla'; fejlec: [string, string]; sorok: Array<[string, string]> }
  | { fajta: 'kerdes-valasz'; kerdes: string; valasz: string }
  | { fajta: 'figyelem'; cim: string; szoveg: string }
  | { fajta: 'kitoltendo'; cim: string; szoveg: string };

export type Szakasz = {
  cim: string;
  /** Rövid, egy soros lényeg — a tárgyaláson ezt olvasod, ha sietsz. */
  lenyeg?: string;
  blokkok: Blokk[];
};

export type BankDokumentum = {
  cim: string;
  alcim: string;
  szakaszok: Szakasz[];
};

/**
 * A letölthető, ÖNÁLLÓ HTML-fájl előállítása ugyanabból az adatból, amiből a
 * képernyő is renderelődik.
 *
 * Szándékosan nincs benne külső hivatkozás (se betűtípus, se szkript): a
 * fájl offline is megnyílik, és a böngésző „Nyomtatás → PDF" funkciójával
 * PDF-fé menthető. Így nem kell PDF-könyvtárat behúzni a projektbe.
 */
export function bankDokumentumHtml(dok: BankDokumentum, datum: string): string {
  const esc = (sz: string) => sz
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

  const blokk = (b: Blokk): string => {
    switch (b.fajta) {
      case 'bekezdes':
        return `<p>${esc(b.szoveg)}</p>`;
      case 'idezet':
        return `<blockquote>${esc(b.szoveg)}</blockquote>`;
      case 'lista':
        return `<ul>${b.elemek.map((e) => `<li>${esc(e)}</li>`).join('')}</ul>`;
      case 'tabla':
        return `<table><thead><tr><th>${esc(b.fejlec[0])}</th><th>${esc(b.fejlec[1])}</th></tr></thead>`
          + `<tbody>${b.sorok.map(([a, c]) => `<tr><td>${esc(a)}</td><td>${esc(c)}</td></tr>`).join('')}</tbody></table>`;
      case 'kerdes-valasz':
        return `<div class="kv"><p class="k">${esc(b.kerdes)}</p><p class="v">${esc(b.valasz)}</p></div>`;
      case 'figyelem':
        return `<div class="doboz figyelem"><p class="cim">${esc(b.cim)}</p><p>${esc(b.szoveg)}</p></div>`;
      case 'kitoltendo':
        return `<div class="doboz kitoltendo"><p class="cim">${esc(b.cim)}</p><p>${esc(b.szoveg)}</p></div>`;
      default:
        return '';
    }
  };

  const torzs = dok.szakaszok.map((sz) => `
    <section>
      <h2>${esc(sz.cim)}</h2>
      ${sz.lenyeg ? `<p class="lenyeg">${esc(sz.lenyeg)}</p>` : ''}
      ${sz.blokkok.map(blokk).join('\n')}
    </section>`).join('\n');

  return `<!doctype html>
<html lang="hu">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(dok.cim)}</title>
<style>
  :root { --sz: #111827; --halvany: #6b7280; --vonal: #e5e7eb; --kiemel: #2563eb; }
  * { box-sizing: border-box; }
  body {
    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Arial, sans-serif;
    color: var(--sz); line-height: 1.6; max-width: 820px; margin: 0 auto; padding: 32px 20px 64px;
  }
  h1 { font-size: 26px; margin: 0 0 4px; }
  .alcim { color: var(--halvany); font-size: 14px; margin: 0 0 4px; }
  .datum { color: var(--halvany); font-size: 13px; margin: 0 0 28px; }
  h2 { font-size: 18px; margin: 32px 0 8px; padding-top: 16px; border-top: 1px solid var(--vonal); }
  section:first-of-type h2 { border-top: 0; padding-top: 0; }
  p { margin: 0 0 12px; }
  .lenyeg { color: var(--kiemel); font-weight: 600; font-size: 14px; }
  blockquote {
    margin: 12px 0; padding: 14px 16px; background: #f3f4f6;
    border-left: 4px solid var(--kiemel); font-size: 15px;
  }
  ul { margin: 0 0 12px; padding-left: 22px; }
  li { margin-bottom: 6px; }
  table { width: 100%; border-collapse: collapse; margin: 12px 0; font-size: 14px; }
  th, td { text-align: left; padding: 8px 10px; border-bottom: 1px solid var(--vonal); vertical-align: top; }
  th { background: #f9fafb; font-weight: 600; }
  td:first-child { width: 38%; font-weight: 600; }
  .kv { margin: 0 0 14px; }
  .kv .k { font-weight: 700; margin: 0 0 2px; }
  .kv .v { margin: 0; }
  .doboz { padding: 14px 16px; border-radius: 8px; margin: 14px 0; }
  .doboz .cim { font-weight: 700; margin: 0 0 6px; }
  .figyelem { background: #fef3c7; border: 1px solid #fcd34d; }
  .kitoltendo { background: #fee2e2; border: 1px solid #fca5a5; }
  .lablec { margin-top: 40px; padding-top: 16px; border-top: 1px solid var(--vonal); color: var(--halvany); font-size: 12px; }
  @media print {
    body { padding: 0; max-width: none; }
    section { break-inside: avoid-page; }
    h2 { break-after: avoid-page; }
    .doboz, blockquote, table { break-inside: avoid; }
  }
</style>
</head>
<body>
  <h1>${esc(dok.cim)}</h1>
  <p class="alcim">${esc(dok.alcim)}</p>
  <p class="datum">Készült: ${esc(datum)}</p>
  ${torzs}
  <p class="lablec">
    Belső felkészülési anyag — nem jogi tanácsadás, és nem helyettesíti az ügyvédi
    átnézést. A tartalom a tárgyalás időpontjában érvényes üzleti feltételeket
    tükrözi; árazás- vagy modellváltozás után frissítendő.
  </p>
</body>
</html>`;
}
