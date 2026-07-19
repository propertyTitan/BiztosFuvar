// Számlázz.hu Számla Agent — a kapcsolatfelvételi díj számlája.
//
// A TELJES API-hívás implementálva van — élesítéshez CSAK az Agent-kulcs
// hiányzik. Aktiválás (Railway env):
//   INVOICE_PROVIDER=szamlazz_hu
//   SZAMLAZZ_AGENT_KEY=<Számlázz.hu fiók → Beállítások → Számla Agent kulcs>
// Opcionális env:
//   SZAMLAZZ_E_INVOICE=false     — ha a fiókban nincs e-számla (default: true)
//   SZAMLAZZ_SEND_EMAIL=false    — a Számlázz.hu NE emailezze ki a számlát (default: true)
//   SZAMLAZZ_INVOICE_PREFIX=...  — számlaszám-előtag (a fiókban kell léteznie)
//   SZAMLAZZ_BASE_URL=...        — default: https://www.szamlazz.hu/szamla/
//   COMPANY_BANK / COMPANY_BANK_ACCOUNT — az eladó banki adatai a számlán
//
// Működés: a díj-fizetés megerősítésekor (webhook) az invoicing.js hívja.
// A számlát a Számlázz.hu állítja ki (NAV-bejelentéssel együtt — az Online
// Számla adatszolgáltatást a Számlázz.hu fiókba bekötött NAV technikai user
// intézi, ezt a fiókban kell egyszer beállítani!), és ha SZAMLAZZ_SEND_EMAIL
// nincs kikapcsolva, e-mailben ki is küldi a vevőnek. PDF-et ezért nem
// töltünk le és nem tárolunk — minden számla elérhető a Számlázz.hu fiókban.
//
// Fontos: a kapcsolatfelvételi díj BRUTTÓ ár (500/1000 Ft — ennyi terhelődik
// a feladónak), ezért a hívó a computeVat-ot amountIsGross:true-val futtatja,
// és itt a nettó/ÁFA/bruttó már konzisztensen érkezik.

const DEFAULT_BASE_URL = 'https://www.szamlazz.hu/szamla/';

function isConfigured() {
  return Boolean(process.env.SZAMLAZZ_AGENT_KEY);
}

function xmlEscape(s) {
  return String(s ?? '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&apos;');
}

// A Számlázz.hu válasz (xmlszamlavalasz) elemei prefix nélküliek, de a
// biztonság kedvéért opcionális namespace-prefixszel illesztünk.
function extractTag(xml, localName) {
  const m = String(xml).match(new RegExp(`<(?:\\w+:)?${localName}>([\\s\\S]*?)</(?:\\w+:)?${localName}>`));
  return m ? m[1].trim() : null;
}

/**
 * Szabadszöveges számlázási cím szétbontása a Számlázz.hu kötelező
 * irsz/telepules/cim mezőire — best-effort. Tipikus alak:
 * "6800 Hódmezővásárhely, Szántó Kovács János utca 144."
 */
function parseBillingAddress(raw) {
  const s = String(raw || '').trim();
  const m = s.match(/^(\d{4})\s+([^,]+?)\s*,\s*(.+)$/);
  if (m) return { zip: m[1], city: m[2].trim(), street: m[3].trim() };
  // Irányítószám nélküli "Város, utca" alak
  const m2 = s.match(/^([^,]+?)\s*,\s*(.+)$/);
  if (m2) return { zip: '0000', city: m2[1].trim(), street: m2[2].trim() };
  // Nem bontható — a teljes szöveg megy címnek, hogy a számla ne bukjon el
  return { zip: '0000', city: s || 'N/A', street: s || 'N/A' };
}

/**
 * A vatResult → Számlázz.hu áfakulcs kód.
 *  - HU 27% (és minden pozitív kulcs): a szám maga ("27")
 *  - EU-s fordított adózású szolgáltatás (Áfa tv. 37.§): "EUFAD37"
 *  - Közösségen kívüli szolgáltatás: "HO" (harmadik ország)
 */
function vatCodeFor(vatResult) {
  if (vatResult.isReverseCharge) return 'EUFAD37';
  if (vatResult.vatRate > 0) return String(Math.round(vatResult.vatRate * 100));
  return 'HO';
}

/**
 * A Számla Agent xmlszamla kérés-XML-je. Az elemek SORRENDJE kötött (XSD)!
 * @param {object} invoiceData — az invoicing.js buildInvoiceData kimenete
 * @param {object} opts — { buyerEmail, vatResult, orderNumber }
 */
function buildInvoiceXml(invoiceData, { buyerEmail, vatResult, orderNumber }) {
  const agentKey = process.env.SZAMLAZZ_AGENT_KEY;
  const eInvoice = process.env.SZAMLAZZ_E_INVOICE !== 'false';
  const sendEmail = process.env.SZAMLAZZ_SEND_EMAIL !== 'false' && Boolean(buyerEmail);
  const prefix = process.env.SZAMLAZZ_INVOICE_PREFIX || '';
  const addr = parseBillingAddress(invoiceData.buyer.address);
  const item = invoiceData.items[0];
  const vatCode = vatCodeFor(vatResult);
  const comment = [
    ...invoiceData.legalTexts,
    invoiceData.jobId ? `Fuvar-azonosító: ${invoiceData.jobId}` : null,
    invoiceData.bookingId ? `Foglalás-azonosító: ${invoiceData.bookingId}` : null,
  ].filter(Boolean).join(' | ');

  return `<?xml version="1.0" encoding="UTF-8"?>
<xmlszamla xmlns="http://www.szamlazz.hu/xmlszamla" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" xsi:schemaLocation="http://www.szamlazz.hu/xmlszamla https://www.szamlazz.hu/szamla/docs/xsds/agent/xmlszamla.xsd">
  <beallitasok>
    <szamlaagentkulcs>${xmlEscape(agentKey)}</szamlaagentkulcs>
    <eszamla>${eInvoice}</eszamla>
    <szamlaLetoltes>false</szamlaLetoltes>
    <valaszVerzio>2</valaszVerzio>
  </beallitasok>
  <fejlec>
    <keltDatum>${invoiceData.issueDate}</keltDatum>
    <teljesitesDatum>${invoiceData.issueDate}</teljesitesDatum>
    <fizetesiHataridoDatum>${invoiceData.issueDate}</fizetesiHataridoDatum>
    <fizmod>${xmlEscape(invoiceData.paymentMethod)}</fizmod>
    <penznem>${xmlEscape(invoiceData.currency)}</penznem>
    <szamlaNyelve>${invoiceData.language === 'hu' ? 'hu' : 'en'}</szamlaNyelve>
    <megjegyzes>${xmlEscape(comment)}</megjegyzes>
    <arfolyamBank>${invoiceData.currency === 'HUF' ? '' : 'MNB'}</arfolyamBank>
    <arfolyam>0</arfolyam>
    <rendelesSzam>${xmlEscape(orderNumber || '')}</rendelesSzam>
    <elolegszamla>false</elolegszamla>
    <vegszamla>false</vegszamla>
    <helyesbitoszamla>false</helyesbitoszamla>
    <dijbekero>false</dijbekero>
    <szamlaszamElotag>${xmlEscape(prefix)}</szamlaszamElotag>
    <fizetve>true</fizetve>
  </fejlec>
  <elado>
    <bank>${xmlEscape(process.env.COMPANY_BANK || '')}</bank>
    <bankszamlaszam>${xmlEscape(process.env.COMPANY_BANK_ACCOUNT || '')}</bankszamlaszam>
    <emailReplyto>info@gofuvar.hu</emailReplyto>
    <emailTargy>GoFuvar – számla a kapcsolatfelvételi díjról</emailTargy>
    <emailSzoveg>Szia! Csatolva küldjük a számlát a GoFuvar kapcsolatfelvételi díjáról. Ha kérdésed van, írj az info@gofuvar.hu címre. Ha fuvar kell, akkor GoFuvar.</emailSzoveg>
  </elado>
  <vevo>
    <nev>${xmlEscape(invoiceData.buyer.name)}</nev>
    <irsz>${xmlEscape(addr.zip)}</irsz>
    <telepules>${xmlEscape(addr.city)}</telepules>
    <cim>${xmlEscape(addr.street)}</cim>
    <email>${xmlEscape(buyerEmail || '')}</email>
    <sendEmail>${sendEmail}</sendEmail>${invoiceData.buyer.taxId ? `
    <adoszam>${xmlEscape(invoiceData.buyer.taxId)}</adoszam>` : ''}
  </vevo>
  <tetelek>
    <tetel>
      <megnevezes>${xmlEscape(item.name)}</megnevezes>
      <mennyiseg>1.0</mennyiseg>
      <mennyisegiEgyseg>${xmlEscape(item.unit)}</mennyisegiEgyseg>
      <nettoEgysegar>${vatResult.netAmount}</nettoEgysegar>
      <afakulcs>${vatCode}</afakulcs>
      <nettoErtek>${vatResult.netAmount}</nettoErtek>
      <afaErtek>${vatResult.vatAmount}</afaErtek>
      <bruttoErtek>${vatResult.grossAmount}</bruttoErtek>
      <megjegyzes>${xmlEscape(invoiceData.jobId ? `GoFuvar fuvar ${invoiceData.jobId}` : (invoiceData.bookingId ? `GoFuvar foglalás ${invoiceData.bookingId}` : ''))}</megjegyzes>
    </tetel>
  </tetelek>
</xmlszamla>`;
}

/**
 * Számla kiállítása a Számlázz.hu Agent API-n.
 * @returns {Promise<{ok: true, invoiceNumber: string} | {ok: false, error: string}>}
 * Hálózati hibán is {ok:false}-t ad vissza — sosem dob.
 */
async function issueInvoice(invoiceData, opts) {
  try {
    if (!isConfigured()) return { ok: false, error: 'SZAMLAZZ_AGENT_KEY hiányzik' };

    const xml = buildInvoiceXml(invoiceData, opts);
    const form = new FormData();
    form.append(
      'action-xmlagentxmlfile',
      new Blob([xml], { type: 'application/xml' }),
      'invoice.xml',
    );

    const res = await fetch(process.env.SZAMLAZZ_BASE_URL || DEFAULT_BASE_URL, {
      method: 'POST',
      body: form,
      signal: AbortSignal.timeout(20_000),
    });
    const body = await res.text();

    // A hibát a Számlázz.hu válasz-headerben ÉS a válasz-XML-ben is jelzi.
    const headerError = res.headers.get('szlahu_error');
    const sikeres = extractTag(body, 'sikeres');
    const invoiceNumber = res.headers.get('szlahu_szamlaszam') || extractTag(body, 'szamlaszam');

    if (!res.ok || headerError || sikeres === 'false' || !invoiceNumber) {
      const code = res.headers.get('szlahu_error_code') || extractTag(body, 'hibakod') || `HTTP ${res.status}`;
      const msg = headerError || extractTag(body, 'hibauzenet') || '';
      return { ok: false, error: `Számlázz.hu hiba [${code}] ${msg}`.trim() };
    }
    return { ok: true, invoiceNumber };
  } catch (e) {
    return { ok: false, error: e.message };
  }
}

module.exports = {
  isConfigured,
  issueInvoice,
  // tesztekhez / belső használatra:
  buildInvoiceXml,
  parseBillingAddress,
  vatCodeFor,
  extractTag,
};
