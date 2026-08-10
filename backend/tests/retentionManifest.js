// =====================================================================
//  RETENCIÓS MANIFEST — minden táblának ismernie kell az életciklusát
//
//  ⚠️ MIÉRT LÉTEZIK EZ A FÁJL: HÁROM egymást követő adatvédelmi audit-kör
//  talált „lefedetlen tábla" találatot (hirdetési fotó, öt tábla retenció
//  nélkül, majd payment_events / DAC7 / félbehagyott foglalás). Mindegyik
//  kör kézzel, egyszer nézte végig — és mindegyik talált újat.
//
//  A projekt ugyanezt a hibaosztályt máshol már gépesítette: van
//  route-manifest őr (új végpont manifest nélkül = piros build) és
//  scrub-ALLOWLIST őr (új jobs-oszlop = tudatos döntés kell). A retencióra
//  nem volt ilyen. Ez a fájl pótolja: minden táblának SZEREPELNIE KELL itt,
//  vagy egy futó retenciós szabállyal, vagy ÍRÁSOS indoklással, hogy miért
//  nincs rá szükség.
//
//  Új tábla létrehozásakor a `retencios-or.test.js` elhasal, amíg ide be nem
//  kerül. Ez a lényeg: a döntés TUDATOS legyen, ne felejtés.
// =====================================================================

/**
 * `szabaly`  — a futó retenciós szabály rövid leírása (van végrehajtó kód)
 * `kivetel`  — miért NEM kell időzített törlés (indoklás kötelező)
 * Pontosan az egyiknek kell szerepelnie.
 */
const RETENTION_MANIFEST = {
  // ── Gépesített retenció ──────────────────────────────────────────────
  photos:              { szabaly: '30 nap a lezárás után; zárolt ügyletnél 5 év (purgeOldDeliveryPhotos, minden fotótípus)' },
  messages:            { szabaly: '6 hónap a lezárás után; zárolt ügyletnél 5 év (purgeOldChatMessages)' },
  location_pings:      { szabaly: '7 nap a rögzítéstől (purgeOldLocationPings)' },
  notifications:       { szabaly: '6 hónap (purgeOldNotifications)' },
  admin_messages:      { szabaly: '3 év — Fgytv. 17/A. § panasz-mérce (purgeOldAdminMessages)' },
  admin_broadcasts:    { szabaly: '3 év, az admin-levelezéssel együtt (purgeOldAdminMessages)' },
  admin_access_log:    { szabaly: '1 év (purgeOldAdminAccessLog) — pontosan amit a tájékoztató ígér' },
  jobs:                { szabaly: 'PII-csupaszítás 3 év után; elhagyott/beragadt fuvar 1 év után lezárul (anonymizeOldJobs + expireAbandonedJobs)' },
  route_bookings:      { szabaly: 'PII-csupaszítás 3 év után; beragadt foglalás 1 év után lezárul (anonymizeOldJobs + expireAbandonedBookings)' },
  bids:                { szabaly: 'a message a fuvar csupaszításakor ürül (anonymizeOldJobs); a sor a fuvarral CASCADE' },
  job_questions:       { szabaly: 'a kérdés/válasz a fuvar csupaszításakor ürül (anonymizeOldJobs); a sor a fuvarral CASCADE' },
  carrier_routes:      { szabaly: 'leírás + jármű-leírás 3 év után ürül, sablon kivéve (anonymizeOldCarrierRoutes)' },
  disputes:            { szabaly: '5 év a LEZÁRÁS után, a bizonyíték-fájllal együtt (purgeOldDisputes); nyitott vita sosem évül el' },
  invoices:            { szabaly: '8 év — Számv. tv. 169. § (2) (purgeOldInvoices)' },
  payment_events:      { szabaly: '8 év, a számlákkal egyező pénzügyi nyom (purgeOldPaymentEvents); a summary nem tartalmaz nevet/címet' },
  sos_events:          { szabaly: 'pontos hely + szabad szöveg 7 nap, a sor 1 év (purgeEmergencyLocations)' },
  tow_requests:        { szabaly: 'pontos hely + rendszám + leírás 7 nap, a sor 1 év (purgeEmergencyLocations)' },
  deleted_accounts:    { szabaly: '5 év (purgeOldDeletedAccounts); a lenyomat HMAC-elt' },
  kyc_doc_history:     { szabaly: '5 év az utolsó használattól (purgeOldKycDocHistory)' },
  kyc_documents:       { szabaly: 'a nyers fotó 30 nap a döntés után, pending 60 nap plafonnal (purgeOldKycFiles); a sor a fiókkal CASCADE' },
  users:               { szabaly: 'DAC7-adat (adóazonosító, születési dátum) 5 év után törlődik (purgeOldTaxData); a fiók maga a felhasználó döntése' },

  // ── Indokolt kivételek (NINCS időzített törlés) ──────────────────────
  carrier_alerts: {
    kivetel: 'A szállító ÉLŐ, bármikor törölhető útvonal-figyelője, nem előzmény-adat. '
      + 'Egy időzített purge némán kikapcsolná a működő értesítőjét. A fiók törlésekor CASCADE viszi. '
      + 'A mögötte lévő valódi kérdés (inaktív fiókok adata) fiók-szintű termékdöntés.',
  },
  reviews: {
    kivetel: 'Az értékelés a profil reputációjának része, a fiók élettartamáig marad — '
      + 'ezt az adatkezelési tájékoztató 5. szakasza kifejezetten így közli. '
      + 'A komment szabad szöveg, de a kapcsolat-szűrő minden beírásnál lefut rajta.',
  },
  push_tokens: {
    kivetel: 'Eszköz-token, a fiók aktív állapotáig — a tájékoztató így közli. '
      + 'Fiók-törléskor CASCADE. (A mobil-fázisban érdemes lesz elavult tokent takarítani.)',
  },
  escrow_transactions: {
    kivetel: 'Pénzügyi elszámolási nyom (összeg + külső fizetési azonosító + fuvar-hivatkozás), '
      + 'közvetlen személyes adatot nem tartalmaz. A fuvarral CASCADE. Az escrow-modell dormant.',
  },
  fee_vouchers: {
    kivetel: 'Kupon (érték + felhasználó-hivatkozás), nem tartalmaz személyes adatot a hivatkozáson túl. '
      + 'Fiók-törléskor CASCADE.',
  },
  user_badges: {
    kivetel: 'Jelvény-hivatkozás, nem tartalmaz személyes adatot a felhasználó-hivatkozáson túl. '
      + 'Fiók-törléskor CASCADE.',
  },
  carrier_route_prices: {
    kivetel: 'Járat-szakaszok árazása, nem tartalmaz személyes adatot. A járattal CASCADE.',
  },
};

module.exports = { RETENTION_MANIFEST };
