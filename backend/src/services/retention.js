// Adat-retenció — a nem-KYC adattípusok gépesített életciklusa
// (az adatkezelési tájékoztató 5. szakaszával szinkronban; a KYC-fotók
// 30 napos törlése külön, a kyc.js-ben él).
//
//   FUVARFOTÓK (pickup/dropoff, 2026-07-16 user-döntés): a lezárás után
//     30 nappal törlődnek; zárolt (photo_retention_hold — vita-nyitás
//     auto-zárol, vagy admin) fuvarnál 5 év. A 'listing'/'damage'/
//     'document' fotókat nem érinti.
//   CHAT-ÜZENETEK (2026-07-17): a lezárás után 6 HÓNAPPAL törlődnek;
//     zárolt ügyletnél 5 év (ugyanaz a hold flag — a zárolás egységes
//     "bizonyíték-megőrzés": fotó + chat együtt).
//   GPS-PINGEK (2026-07-17): 7 nap után törlődnek (rögzítéstől — az élő
//     GPS a mobil-fázisban indul, de a job már most él, így sosem gyűlhet).
//   ADMIN-ÜZENETEK (2026-08-08): az admin ↔ user levelezés a küldéstől
//     számított 3 ÉV után törlődik (a fogyasztóvédelmi panasz-megőrzés
//     3 éves mércéjéhez igazítva — Fgytv. 17/A. §; a csatornán panasz is
//     érkezhet). A körüzenet-napló (admin_broadcasts) ugyanennyi.
//     Fiók-törléskor a user szála azonnal megy (FK CASCADE).
//   AJÁNLAT-ÜZENET + KÉRDÉS-VÁLASZ (2026-08-09): a fuvar anonimizálásakor
//     ürül — ugyanaz az adat, mint a fuvar leírása, csak másik táblában.
//   JÁRAT (2026-08-09): a lejárt, nem-sablon járat leírása 3 év után ürül
//     (a `waypoints` sok soron át mozgásprofillá állna össze).
//   VITA (2026-08-09): a LEZÁRT vita 5 év után törlődik — ugyanannyi, mint
//     a miatta zárolt bizonyíték. Nyitott vita sosem évül el.
//   SZÁMLA (2026-08-09): 8 év — Számv. tv. 169. § (2). Ez a leghosszabb kör
//     a rendszerben, és jogszabályi kötelezettség, nem a mi döntésünk.
//
// Naponta fut (index.js: runDailyRetention). Soha nem dob.

const db = require('../db');
// Modul-objektumként (nem destrukturálva): így a tároló-törlés tesztből
// megfigyelhető — a destrukturált binding mellett egyetlen teszt sem tudta
// ellenőrizni, hogy a fájl tényleg elmegy a tárolóból.
const storage = require('./storage');
const { telepulesSzint } = require('../utils/address');

const DEFAULT_RETENTION_DAYS = 30;
const HOLD_RETENTION_YEARS = 5;
const ADMIN_DM_RETENTION_YEARS = 3;
// Számviteli bizonylat — Számv. tv. 169. § (2). Ez a rendszer LEGHOSSZABB
// megőrzési ideje, és szándékosan az: jogszabályi kötelezettség, nem a mi
// döntésünk. Rövidíteni nem szabad, de nyolc év után elévül.
const INVOICE_RETENTION_YEARS = 8;

// Terminális státuszok — csak lezárt ügylet fotóját törölhetjük
// ⚠️ MINDEN fotótípus (2026-08-09, adatvédelmi audit 3. kör). A purge korábban
// CSAK a 'pickup' és 'dropoff' képekre futott — a hirdetéshez feltöltött
// ('listing') fotó tehát ÖRÖKRE megmaradt, ráadásul a PUBLIKUS bucketben,
// egyéves immutable cache-sel. Ezt a FELADÓ tölti fel a saját lakásában
// (bútor, doboz, a szoba belseje), és a kívülállók is látják — vagyis a
// leghosszabb ideig tartó, legszélesebb körű expozíció volt a rendszerben,
// miközben a tájékoztató 30 napot ígért a fuvar-fotókra.
// A 'damage'/'document' ugyanígy: vitás ügyletnél a photo_retention_hold
// úgyis 5 évig megvédi őket.
const PHOTO_KINDS = ['listing', 'pickup', 'dropoff', 'damage', 'document'];

const JOB_TERMINAL = ['delivered', 'completed', 'cancelled'];
const BOOKING_TERMINAL = ['delivered', 'rejected', 'cancelled'];

/**
 * Lejárt felvételi/lerakós fotók törlése.
 * @returns {Promise<number>} a törölt fotók száma
 */
async function purgeOldDeliveryPhotos() {
  let purged = 0;
  try {
    // --- Fuvar-fotók ---
    const { rows: jobPhotos } = await db.query(
      `SELECT p.id, p.url
         FROM photos p
         JOIN jobs j ON j.id = p.job_id
        WHERE p.kind = ANY($4)
          AND (
            (j.photo_retention_hold = FALSE
              AND j.status = ANY($1)
              AND j.updated_at < NOW() - ($2 || ' days')::interval)
            OR
            (j.photo_retention_hold = TRUE
              AND j.updated_at < NOW() - ($3 || ' years')::interval)
          )`,
      [JOB_TERMINAL, DEFAULT_RETENTION_DAYS, HOLD_RETENTION_YEARS, PHOTO_KINDS],
    );

    // --- Foglalás-fotók (route_bookings; nincs updated_at → delivered_at
    //     vagy created_at a viszonyítás) ---
    const { rows: bookingPhotos } = await db.query(
      `SELECT p.id, p.url
         FROM photos p
         JOIN route_bookings b ON b.id = p.booking_id
        WHERE p.kind = ANY($4)
          AND (
            (b.photo_retention_hold = FALSE
              AND b.status::text = ANY($1)
              AND COALESCE(b.delivered_at, b.created_at) < NOW() - ($2 || ' days')::interval)
            OR
            (b.photo_retention_hold = TRUE
              AND COALESCE(b.delivered_at, b.created_at) < NOW() - ($3 || ' years')::interval)
          )`,
      [BOOKING_TERMINAL, DEFAULT_RETENTION_DAYS, HOLD_RETENTION_YEARS, PHOTO_KINDS],
    );

    let beragadt = 0;
    for (const p of [...jobPhotos, ...bookingPhotos]) {
      const ok = await storage.deleteFile(p.url);
      // ⚠️ SIKERTELEN TÖRLÉSNÉL MEGTARTJUK A DB-SORT (2026-08-11, 8. mérés).
      // A deleteFile R2-hibánál CSENDBEN false-t ad. Ha ilyenkor is töröltük
      // a photos sort — az EGYETLEN mutatót —, az objektum VÉGLEGESEN a
      // PUBLIKUS bucketben maradt: se retry, se riasztás, se sepregető.
      // A sor megtartásával a holnapi kör újrapróbálja. (data:URL és már
      // hiányzó objektum true-t ad, tehát azok nem ragadnak be.)
      // Ugyanez a hibaosztály a KYC-ágon már zárva volt (services/kyc.js).
      if (!ok) {
        beragadt += 1;
        continue;
      }
      await db.query('DELETE FROM photos WHERE id = $1', [p.id]);
      purged += 1;
    }
    if (beragadt > 0) {
      console.error(`[photo-retention] ${beragadt} fotó tároló-törlése sikertelen — a DB-sort MEGTARTJUK, holnap újrapróbáljuk`);
      try {
        require('@sentry/node').captureMessage(
          `[photo-retention] ${beragadt} fotó törlése sikertelen (tároló-hiba) — a mutatók megmaradtak`,
          'warning',
        );
      } catch { /* a Sentry hiánya ne akassza meg a kört */ }
    }
    if (purged > 0) {
      console.log(`[photo-retention] ${purged} felvételi/lerakós fotó törölve (>${DEFAULT_RETENTION_DAYS} nap, zároltak: ${HOLD_RETENTION_YEARS} év)`);
    }
  } catch (err) {
    console.error('[photo-retention] hiba:', err.message);
  }
  return purged;
}

const CHAT_RETENTION_MONTHS = 6;
const GPS_RETENTION_DAYS = 7;
// Az értesítések fél évig maradnak: a felhasználónak ennyi idő után már
// nincs haszna belőlük, viszont a body-juk PII-t hordozhat (lásd
// purgeOldNotifications).
const NOTIFICATION_RETENTION_MONTHS = 6;
// Az admin-hozzáférési napló megőrzése — pontosan annyi, amennyit az
// adatkezelési tájékoztató ígér („File-hozzáférési audit log: 1 évig”).
const ADMIN_ACCESS_LOG_RETENTION_YEARS = 1;

// A LEZÁRT FUVAR/FOGLALÁS személyes adatai ennyi idő után anonimizálódnak.
// 3 év = az általános polgári jogi elévülés (Ptk. 6:22. §): eddig kell tudni
// bizonyítani, ki mit vállalt. Utána a személyes adat már nem indokolt.
// Zárolt (vitás vagy admin-holdos) ügyletnél 5 év — ugyanaz a `photo_retention_hold`
// flag védi, mint a fotókat és a chatet: egységes bizonyíték-megőrzés.
const JOB_PII_RETENTION_YEARS = 3;

// A VÉSZHELYZETI helyadat (SOS-jelzés, mentés-kérés) két lépcsőben évül el:
//  - 7 nap után a PONTOS koordináta és a szabad szöveg törlődik (ugyanaz a
//    határidő, amit a tájékoztató a nyers GPS-adatra ígér);
//  - 1 év után maga a sor is. A vészhelyzet TÉNYE addig megmarad (jogi
//    igényérvényesítés, baleset utáni bizonyítás), de már hely nélkül.
const SOS_LOCATION_RETENTION_DAYS = 7;
const SOS_EVENT_RETENTION_YEARS = 1;

// A törölt fiókok audit-nyoma. 5 év = a polgári jogi igényérvényesítés
// felső határa; utána a törlés ténye sem indokolt.
const DELETED_ACCOUNT_RETENTION_YEARS = 5;

// ⚠️ ALVÓ FIÓKOK (2026-08-12, user-döntés a 10. mérés F6-jára). Egy fiók, ami
// évek óta nem lépett be, HATÁRIDŐ NÉLKÜL őrizte a nevet, e-mailt, telefont,
// rendszámot, avatart és bemutatkozást. A tájékoztató „a fiókod
// élettartamáig"-ot ír — formálisan igaz, de az „élettartam" végtelen volt.
const DORMANT_WARN_YEARS = 3;
const DORMANT_DELETE_DAYS = 30;

/**
 * Lejárt chat-üzenetek törlése: lezárt ügylet üzenetei 6 hónap után,
 * zárolt (vitás/admin-holdos) ügyletéi 5 év után.
 * @returns {Promise<number>} a törölt üzenetek száma
 */
async function purgeOldChatMessages() {
  let purged = 0;
  try {
    const { rowCount: jobMsgs } = await db.query(
      `DELETE FROM messages m
        USING jobs j
        WHERE m.job_id = j.id
          AND (
            (j.photo_retention_hold = FALSE
              AND j.status = ANY($1)
              AND j.updated_at < NOW() - ($2 || ' months')::interval)
            OR
            (j.photo_retention_hold = TRUE
              AND j.updated_at < NOW() - ($3 || ' years')::interval)
          )`,
      [JOB_TERMINAL, CHAT_RETENTION_MONTHS, HOLD_RETENTION_YEARS],
    );
    const { rowCount: bookingMsgs } = await db.query(
      `DELETE FROM messages m
        USING route_bookings b
        WHERE m.booking_id = b.id
          AND (
            (b.photo_retention_hold = FALSE
              AND b.status::text = ANY($1)
              AND COALESCE(b.delivered_at, b.created_at) < NOW() - ($2 || ' months')::interval)
            OR
            (b.photo_retention_hold = TRUE
              AND COALESCE(b.delivered_at, b.created_at) < NOW() - ($3 || ' years')::interval)
          )`,
      [BOOKING_TERMINAL, CHAT_RETENTION_MONTHS, HOLD_RETENTION_YEARS],
    );
    purged = (jobMsgs || 0) + (bookingMsgs || 0);
    if (purged > 0) {
      console.log(`[retention] ${purged} chat-üzenet törölve (>${CHAT_RETENTION_MONTHS} hónap, zároltak: ${HOLD_RETENTION_YEARS} év)`);
    }
  } catch (err) {
    console.error('[retention] chat-purge hiba:', err.message);
  }
  return purged;
}

/**
 * 7 napnál régebbi nyers GPS-pingek törlése (adatkezelési ígéret).
 * @returns {Promise<number>} a törölt pingek száma
 */
async function purgeOldLocationPings() {
  try {
    const { rowCount } = await db.query(
      `DELETE FROM location_pings WHERE recorded_at < NOW() - ($1 || ' days')::interval`,
      [GPS_RETENTION_DAYS],
    );
    if (rowCount > 0) console.log(`[retention] ${rowCount} GPS-ping törölve (>${GPS_RETENTION_DAYS} nap)`);
    return rowCount || 0;
  } catch (err) {
    console.error('[retention] GPS-purge hiba:', err.message);
    return 0;
  }
}

/**
 * 3 évnél régebbi admin ↔ user üzenetek + körüzenet-napló törlése.
 * (2026-08-08: a feature-rel együtt gépesítve, hogy a "minden adattípus
 * életciklusa gépesített" állítás igaz maradjon.)
 * @returns {Promise<number>} a törölt sorok száma
 */
async function purgeOldAdminMessages() {
  try {
    const { rowCount: msgs } = await db.query(
      `DELETE FROM admin_messages WHERE created_at < NOW() - ($1 || ' years')::interval`,
      [ADMIN_DM_RETENTION_YEARS],
    );
    const { rowCount: bcs } = await db.query(
      `DELETE FROM admin_broadcasts WHERE created_at < NOW() - ($1 || ' years')::interval`,
      [ADMIN_DM_RETENTION_YEARS],
    );
    const purged = (msgs || 0) + (bcs || 0);
    if (purged > 0) {
      console.log(`[retention] ${purged} admin-üzenet/körüzenet törölve (>${ADMIN_DM_RETENTION_YEARS} év)`);
    }
    return purged;
  } catch (err) {
    console.error('[retention] admin-üzenet purge hiba:', err.message);
    return 0;
  }
}

/**
 * A szállító UTOLSÓ ISMERT pozíciójának elévülése.
 *
 * ⚠️ 2026-08-09 (adatvédelmi audit): a nyers GPS-pingeket 7 nap után töröltük,
 * de a `users.last_known_lat/lng` egy MÁSOLAT ugyanarról a koordinátáról —
 * és arra semmilyen retenció nem volt. Az utolsó ping tipikusan a nap végi
 * tartózkodási hely (gyakran a lakcím környéke), vagyis a fiók élettartamáig
 * őriztünk egy pontos otthon-koordinátát, miközben a tájékoztató 7 napot ígér.
 * A mező a matchinghez kell (azonnali fuvar, mentős) — a friss érték marad,
 * a 7 napnál régebbi törlődik.
 * @returns {Promise<number>} a nullázott sorok száma
 */
async function purgeStaleLastKnownLocation() {
  try {
    const { rowCount } = await db.query(
      `UPDATE users
          SET last_known_lat = NULL, last_known_lng = NULL
        WHERE (last_known_lat IS NOT NULL OR last_known_lng IS NOT NULL)
          AND (last_ping_at IS NULL OR last_ping_at < NOW() - ($1 || ' days')::interval)`,
      [GPS_RETENTION_DAYS],
    );
    if (rowCount > 0) {
      console.log(`[retention] ${rowCount} elavult utolsó-pozíció törölve (>${GPS_RETENTION_DAYS} nap)`);
    }
    return rowCount || 0;
  } catch (err) {
    console.error('[retention] utolsó-pozíció purge hiba:', err.message);
    return 0;
  }
}

/**
 * Régi ÉRTESÍTÉSEK törlése.
 *
 * ⚠️ 2026-08-09 (adatvédelmi audit): a `notifications` táblának NEM VOLT
 * életciklusa, pedig a `body` mezőben PII-t hordoz (SOS: teljes név +
 * telefonszám + pontos GPS; mentés-elvállalás: telefonszám; chat-értesítés: az
 * üzenet első 100 karaktere). Ez utóbbi ráadásul TÚLÉLTE a 6 hónapos
 * chat-retenciót: a `messages` sor törlődött, a másolata az értesítésben
 * maradt. Az „minden adattípus életciklusa gépesített" állítás enélkül nem
 * volt igaz.
 * @returns {Promise<number>} a törölt sorok száma
 */
async function purgeOldNotifications() {
  try {
    const { rowCount } = await db.query(
      `DELETE FROM notifications WHERE created_at < NOW() - ($1 || ' months')::interval`,
      [NOTIFICATION_RETENTION_MONTHS],
    );
    if (rowCount > 0) {
      console.log(`[retention] ${rowCount} értesítés törölve (>${NOTIFICATION_RETENTION_MONTHS} hónap)`);
    }
    return rowCount || 0;
  } catch (err) {
    console.error('[retention] értesítés-purge hiba:', err.message);
    return 0;
  }
}

/**
 * Az admin-hozzáférési napló elévülése (1 év — a tájékoztató ígérete).
 * @returns {Promise<number>} a törölt sorok száma
 */
async function purgeOldAdminAccessLog() {
  try {
    const { rowCount } = await db.query(
      `DELETE FROM admin_access_log WHERE created_at < NOW() - ($1 || ' years')::interval`,
      [ADMIN_ACCESS_LOG_RETENTION_YEARS],
    );
    if (rowCount > 0) {
      console.log(`[retention] ${rowCount} admin-hozzáférési naplósor törölve (>${ADMIN_ACCESS_LOG_RETENTION_YEARS} év)`);
    }
    return rowCount || 0;
  } catch (err) {
    console.error('[retention] admin-napló purge hiba:', err.message);
    return 0;
  }
}

/**
 * A lezárt fuvarok és foglalások SZEMÉLYES ADATAINAK anonimizálása.
 *
 * ⚠️ 2026-08-09 (adatvédelmi audit, 2. kör): a `jobs` és a `route_bookings`
 * táblának SEMMILYEN megőrzési ideje nem volt. A köré épült adatokat
 * gépiesen töröltük (fotó 30 nap, chat 6 hónap, GPS 7 nap), de maga a
 * fuvar-sor — benne a PONTOS felvételi és lerakodási címmel, a
 * koordinátákkal, a címzett teljes elérhetőségével és a csomag deklarált
 * értékével — ÖRÖKRE megmaradt. A tájékoztató hét adattípusra ad megőrzési
 * időt; erre nem adott (GDPR 5. cikk (1) e).
 *
 * TÖRLÉS HELYETT ANONIMIZÁLÁS: a fuvar TÉNYE üzletileg kell (statisztika,
 * értékelés-előzmény, elszámolás), a személyes adat viszont nem. Ezért a
 * sor megmarad, de a PII-mezők ürülnek, a cím pedig településre rövidül.
 * Ez egyben a „nem lehet visszaállítani" garanciát is adja — szemben egy
 * soft-delete flaggel.
 *
 * @returns {Promise<number>} az anonimizált sorok száma
 */
/**
 * ADAT-INTEGRITÁS JAVÍTÓ KÖR: vitás ügylet zárolás nélkül.
 *
 * A 9. mérés találata (T1-R). A retenció két ágon dolgozik:
 *   (hold=FALSE ES lezart statusz)  VAGY  (hold=TRUE)
 * A 'disputed' nincs a lezart statuszok kozt, tehat a 'disputed' + hold=FALSE
 * kombinacio MINDKETTOBOL kiesik - es nincs kod-ut, ami kihozna: az
 * expireAbandonedJobs szandekosan kihagyja a vitast, a purgeOldDisputes pedig
 * a disputes tablat nezi, amiben ilyenkor nincs sor.
 *
 * A beiro utakat elzartuk (az admin nem allithat kezzel disputed-et, es vitas
 * ugyleten nem oldhato fel a zarolas), DE a MAR MEGLEVO sorok ettol meg ilyen
 * allapotban lehetnek. Ezert a takaritas elott helyreallitjuk az invariánst:
 * vitás ügylet MINDIG zárolt. Így a bizonyíték megmarad (ez a zárolás célja),
 * és 5 év után szabályosan törlődik.
 */
async function repairDisputedHold() {
  try {
    let javitva = 0;
    for (const tabla of ['jobs', 'route_bookings']) {
      const { rowCount } = await db.query(
        `UPDATE ${tabla} SET photo_retention_hold = TRUE
          WHERE status::text = 'disputed' AND photo_retention_hold = FALSE`,
      );
      javitva += rowCount;
    }
    if (javitva > 0) {
      console.log(`[retention] ${javitva} vitas ugylet zarolasa helyreallitva (invarians: vitas = zarolt)`);
    }
    return javitva;
  } catch (err) {
    console.error('[retention] disputed-hold javitas hiba:', err.message);
    return 0;
  }
}

/**
 * ALVÓ FIÓKOK: figyelmeztetés, majd törlés.
 *
 * KÉT FÁZIS, mert az előzmény nélküli törlés elfogadhatatlan lenne:
 *   1. 3 év tétlenség után FIGYELMEZTETŐ e-mail (dormant_warned_at = NOW()),
 *   2. ha a következő 30 napban sem lép be, a fiók törlődik.
 * Egyetlen bejelentkezés nullázza a jelzőt (auth.js), tehát visszaáll az óra.
 *
 * ⚠️ A TÖRLÉS UGYANAZT AZ UTAT JÁRJA, mint a self-delete: előbb a TÁROLÓBÓL
 * visszük el a fájlokat (KYC-okmány, avatar, fuvar-fotók), csak utána a
 * DB-sort — különben árva objektumok maradnának a bucketben (GDPR 17.).
 *
 * ⚠️ AMI VÉDI: `userHasBlockingDealings` — aktív+fizetett vagy vitatott
 * ügyletnél NEM törlünk. Egy alvó feladó törlése különben MÁS emberek
 * folyamatban lévő ügyleteit semmisítené meg (CASCADE), és a vitás ügyletek
 * 5 éves bizonyíték-zárolását is kiütné.
 */
async function purgeDormantAccounts() {
  const { userHasBlockingDealings } = require('../utils/activePaid');
  const { purgeUserFiles, collectUserFileKeys } = require('../utils/userFiles');
  let figyelmeztetve = 0;
  let torolve = 0;

  // 1. FÁZIS — figyelmeztetés
  const { rows: jeloltek } = await db.query(
    `SELECT id, email, full_name
       FROM users
      WHERE dormant_warned_at IS NULL
        AND role <> 'admin'
        AND COALESCE(last_login_at, created_at) < NOW() - ($1 || ' years')::interval
      LIMIT 200`,
    [DORMANT_WARN_YEARS],
  );
  for (const u of jeloltek) {
    if (await userHasBlockingDealings(u.id)) continue;
    const hatarido = new Date(Date.now() + DORMANT_DELETE_DAYS * 86400000);
    try {
      const { sendDormantAccountWarningEmail } = require('./email');
      await sendDormantAccountWarningEmail({
        to: u.email, name: u.full_name, deleteDate: hatarido,
      });
    } catch (e) {
      console.warn('[dormant] figyelmeztetes hiba:', e.message);
      continue; // e-mail nelkul NEM inditjuk el az orat
    }
    await db.query('UPDATE users SET dormant_warned_at = NOW() WHERE id = $1', [u.id]);
    figyelmeztetve += 1;
  }

  // 2. FÁZIS — törlés
  const { rows: torlendok } = await db.query(
    `SELECT id FROM users
      WHERE dormant_warned_at IS NOT NULL
        AND dormant_warned_at < NOW() - ($1 || ' days')::interval
        AND role <> 'admin'
        AND COALESCE(last_login_at, created_at) < NOW() - ($2 || ' years')::interval
      LIMIT 100`,
    [DORMANT_DELETE_DAYS, DORMANT_WARN_YEARS],
  );
  for (const u of torlendok) {
    if (await userHasBlockingDealings(u.id)) continue;
    // A fajl-kulcsokat MEG a DB-sorok megléte mellett gyűjtjük ki.
    const keys = await collectUserFileKeys(u.id).catch(() => []);
    await db.query('DELETE FROM users WHERE id = $1', [u.id]);
    await purgeUserFiles(u.id, { keys });
    torolve += 1;
  }

  if (figyelmeztetve || torolve) {
    console.log(`[dormant] ${figyelmeztetve} figyelmeztetve, ${torolve} alvo fiok torolve`);
  }
  return figyelmeztetve + torolve;
}

async function anonymizeOldJobs() {
  let db_count = 0;
  try {
    // A címből csak a település marad (az első vessző előtti rész), a
    // koordináta ~1 km-re kerekítve — ugyanaz a felbontás, amit a kívülálló
    // scrub ad az elkelt fuvarokra.
    const { rowCount: jobs } = await db.query(
      `UPDATE jobs
          SET recipient_name  = NULL,
              recipient_phone = NULL,
              recipient_email = NULL,
              delivery_code   = NULL,
              sender_delivery_code = NULL,
              tracking_token  = NULL,
              pickup_lat  = ROUND(pickup_lat::numeric, 2),
              pickup_lng  = ROUND(pickup_lng::numeric, 2),
              dropoff_lat = ROUND(dropoff_lat::numeric, 2),
              dropoff_lng = ROUND(dropoff_lng::numeric, 2),
              description = NULL,
              cancel_reason = NULL,
              -- 2026-08-09 (3. kör): a description mellől ez a négy kimaradt.
              -- A title ugyanúgy felhasználó által írt szabad szöveg
              -- („Anyukám bútorai a Fő utca 12-ből"); az
              -- ai_description_notes a leírásból SZÁRMAZIK, tehát ugyanazt
              -- a PII-t hordozhatja, amit épp töröltünk; a source_image_url
              -- pedig a shipper_id-vel együtt megőrizte, ki mit vásárolt.
              title = '(törölt fuvar)',
              ai_description_notes = NULL,
              source_image_url = NULL,
              -- A 060-as migráció indoklása KIFEJEZETTEN nevesíti a csomag
              -- deklarált értékét, az UPDATE mégis bennhagyta. A bolt neve
              -- ugyanígy: a shipper_id-vel együtt vásárlási előzmény.
              declared_value_huf = NULL,
              source_store = NULL,
              -- A lakás belső adottságai (hányadik emelet, van-e lift) a
              -- címnél is beszédesebbek — üzleti értékük a lezárás után nincs.
              -- Ez a négy oszlop NOT NULL, ezért semleges alapértékre áll.
              pickup_floor = 0,
              dropoff_floor = 0,
              -- A needs_carrying PARJA IS (2026-08-11, 10. meres F1). Az emelet
              -- es a lift urult, a kell-e cipelni nem - pedig a kod sajat
              -- indoklasa (a lakas belso adottsagai; uzleti ertekuk a lezaras
              -- utan nincs) pontosan ugyanigy all ra.
              pickup_needs_carrying = FALSE,
              dropoff_needs_carrying = FALSE,
              pickup_has_elevator = FALSE,
              dropoff_has_elevator = FALSE,
              anonymized_at = NOW()
        WHERE anonymized_at IS NULL
          -- ⚠️ A STÁTUSZ-SZŰRŐ CSAK A NEM ZÁROLT ÁGRA VONATKOZIK (2026-08-11).
          -- Korábban felső szinten állt, ezért a disputed fuvar (ami nincs a
          -- JOB_TERMINAL-ban) SOHA nem anonimizálódott: ha egy vitát nem zárnak
          -- le, a címzett neve/telefonja/e-mailje, az átvételi kód, az ÉLŐ
          -- követő-token és a házszámig pontos cím HATÁRIDŐ NÉLKÜL megmaradt —
          -- miközben a tájékoztató 5 évet ígér. Ugyanennek a fájlnak a fotó- és
          -- chat-purge ága már helyesen járt el (a zárolt ág ott sem szűr
          -- státuszra); ez az ág csúszott ki alóla.
          AND (
            (photo_retention_hold = FALSE AND status = ANY($1)
              AND updated_at < NOW() - ($2 || ' years')::interval)
            OR
            (photo_retention_hold = TRUE  AND updated_at < NOW() - ($3 || ' years')::interval)
          )`,
      [JOB_TERMINAL, JOB_PII_RETENTION_YEARS, HOLD_RETENTION_YEARS],
    );

    const { rowCount: bookings } = await db.query(
      `UPDATE route_bookings
          SET recipient_name  = NULL,
              recipient_phone = NULL,
              recipient_email = NULL,
              delivery_code   = NULL,
              tracking_token  = NULL,
              pickup_lat  = ROUND(pickup_lat::numeric, 2),
              pickup_lng  = ROUND(pickup_lng::numeric, 2),
              dropoff_lat = ROUND(dropoff_lat::numeric, 2),
              dropoff_lng = ROUND(dropoff_lng::numeric, 2),
              notes = NULL,
              -- ⚠️ 2026-08-11: a cancel_reason a FUVAR-ágon (fent) NULL-ra
              -- áll, a foglalási ágon kimaradt. Felhasználó által írt szabad
              -- szöveg („nem volt otthon senki a Fő u. 12-ben, hívtam a
              -- 06-30…-t"), és határidő nélkül maradt volna.
              cancel_reason = NULL,
              anonymized_at = NOW()
        WHERE anonymized_at IS NULL
          -- ⚠️ Ugyanaz, mint a fuvar-ágon: a státusz-szűrő csak a NEM zárolt
          -- ágra való, különben a lezáratlan vitás foglalás örökre PII marad.
          AND (
            (photo_retention_hold = FALSE
              AND status::text = ANY($1)
              AND COALESCE(delivered_at, created_at) < NOW() - ($2 || ' years')::interval)
            OR
            (photo_retention_hold = TRUE
              AND COALESCE(delivered_at, created_at) < NOW() - ($3 || ' years')::interval)
          )`,
      [BOOKING_TERMINAL, JOB_PII_RETENTION_YEARS, HOLD_RETENTION_YEARS],
    );

    // ── A fuvar KÖRÉ épült szabad szöveg (2026-08-09, 3. kör) ──
    // A fuvar `description`-jét kiürítettük, de a RÓLA szóló beszélgetés két
    // másik táblában él tovább: a szállító ajánlat-üzenetében és a nyilvános
    // kérdés-válasz szálban. Ugyanaz az adat (mit szállítunk, hogyan lehet
    // megközelíteni a lakást, ki lesz otthon), csak másik sorban — ezért
    // ugyanakkor is kell elévülnie.
    //
    // A már anonimizált fuvarhoz kötjük, nem külön időszámításhoz: így egy
    // szabály van, egy időbélyeg és egy zárolás-jelző, és a kör önjavító
    // (a korábban anonimizált sorok szövegét is elkapja).
    const { rowCount: bidMsgs } = await db.query(
      // A SOR MAGA IS ELMEGY, NEM CSAK A SZÖVEGE (2026-08-11, 9. mérés M1).
      // A manifest azt állította, hogy „a sor a fuvarral CASCADE" — ez HAMIS
      // premissza volt: a fuvart NEM töröljük, hanem anonimizáljuk, tehát a
      // fuvar sora megmarad, és vele az összes rá adott ajánlat. Az üres
      // üzenetű sor is viselkedési adat egy személyről: „X szállító Y forintot
      // ajánlott Z fuvarra T időpontban" — határidő nélkül. Az anonimizált
      // (3+ éves) fuvarnál ennek semmilyen célja nincs.
      `DELETE FROM bids b
         USING jobs j
        WHERE b.job_id = j.id
          AND j.anonymized_at IS NOT NULL`,
    );

    const { rowCount: questions } = await db.query(
      // Ugyanaz, mint a bids-nél: a kérdés/válasz SORA is viselkedési adat
      // (ki érdeklődött mikor melyik fuvarra), nem csak a szövege.
      `DELETE FROM job_questions q
         USING jobs j
        WHERE q.job_id = j.id
          AND j.anonymized_at IS NOT NULL`,
    );

    db_count = (jobs || 0) + (bookings || 0);
    if (db_count > 0) {
      console.log(`[retention] ${db_count} lezárt fuvar/foglalás személyes adata anonimizálva (>${JOB_PII_RETENTION_YEARS} év, zároltak: ${HOLD_RETENTION_YEARS} év)`);
    }
    // A cím-rövidítés az anonimizálás RÉSZE — a hívónak egy lépés. (Külön is
    // exportált, mert önjavítóan a korábban, hibás szabállyal anonimizált
    // sorokat is rendbe teszi.)
    await shortenAnonymizedAddresses();

    if ((bidMsgs || 0) + (questions || 0) > 0) {
      console.log(`[retention] ${bidMsgs || 0} ajánlat-üzenet és ${questions || 0} kérdés-válasz ürítve anonimizált fuvarokon`);
    }
  } catch (err) {
    // ⚠️ A HIBA NEM NYELHETO EL (2026-08-11, sajat talalat a 10. kor kozben).
    // Ez a catch csendben lenyelte az SQL-hibat, es 0-t adott vissza — a
    // `runDailyRetention` ezt SIKERES kornek latta, a `retention_runs` naplo
    // pedig „0 anonimizalt sort" rogzitett. Egy elgepeles az UPDATE-ben
    // (nekem egy JS-komment `//` az SQL belsejeben) igy HONAPOKIG futhatott
    // volna hatas nelkul, es SEMMI nem jelezte volna: a fuvarok PII-ja
    // hatarido nelkul bent marad, miközben a napi kor „lefutott".
    //
    // A hibat ezert TOVABBDOBJUK: a `runDailyRetention` sajat catch-e elkapja,
    // beirja a `retention_runs.hibak`-ba (maszkolva), es Sentry-riasztast kuld.
    // A tobbi kor ettol meg lefut — a kulon-kulon hibatures ott van, ahol kell.
    console.error('[retention] fuvar-anonimizalas hiba:', err.message);
    throw err;
  }
  return db_count;
}

// Az ELHAGYOTT (soha le nem zárt) fuvar ennyi idő után lejár. A feladó
// feladta, majd otthagyta: nincs ajánlat, nincs lemondás, nincs teljesítés.
// Egy év bőven elég ahhoz, hogy egy valódi fuvar elkeljen.
const ABANDONED_JOB_YEARS = 1;

/**
 * Elhagyott fuvarok lezárása.
 *
 * ⚠️ 2026-08-09 (két független lencse találata): az anonimizálás ÉS a
 * fotó-purge is CSAK terminális státuszú (delivered/completed/cancelled)
 * fuvarra futott. Egy `bidding`/`pending` állapotban otthagyott fuvarnak
 * tehát SEMMILYEN életciklusa nem volt: örökre őrizte a pontos felvételi és
 * lerakodási címet, a koordinátákat, a címzett nevét/telefonját/e-mailjét,
 * az átvételi kódot, a követő-tokent és a hirdetési fotókat.
 *
 * Ráadásul a `bidding` NYITOTT státusz, tehát a kívülálló-scrub nem is
 * kerekíti a címet: bármely bejelentkezett felhasználó évek múlva is látta
 * volna a listán a pontos otthoni címet.
 *
 * A lezárás után a szokásos körök (anonimizálás 3 év, fotó 30 nap) már
 * elérik — nem külön szabályt vezetünk be, hanem a meglévők hatálya alá
 * hozzuk a beragadt sorokat.
 *
 * @returns {Promise<number>} a lezárt fuvarok száma
 */
async function expireAbandonedJobs() {
  try {
    const { rowCount } = await db.query(
      `UPDATE jobs
          SET status = 'cancelled',
              cancelled_at = NOW(),
              cancel_reason = CASE
                WHEN status IN ('pending','bidding')
                  THEN 'Automatikusan lezárva: a fuvar egy évig nem talált szállítót.'
                ELSE 'Automatikusan lezárva: a fuvar egy éve nem mozdult.'
              END,
              updated_at = NOW()
        WHERE (
            -- Sosem kelt el VAGY újranyitás után nem talált új szállítót.
            -- ⚠️ A paid_at IS NULL FELTÉTEL KIVÉVE (2026-08-11, állapot-mátrix).
            -- A díjmentes újraválasztás (reopenJobForNewDriver) a fuvart
            -- VISSZAÁLLÍTJA 'bidding'-re, de a paid_at-ot MEGTARTJA — tehát a
            -- „fizetett, mégis nyitott" fuvar teljesen normális állapot. A régi
            -- feltétel ezeket kizárta a lejáratásból, így egy kifizetett, majd
            -- soha újra el nem vállalt fuvar HATÁRIDŐ NÉLKÜL őrizte a címzett
            -- adatait, az átvételi kódot és az élő követő-tokent.
            -- Egy év mozdulatlanság után a fuvar akkor is elhagyott, ha fizettek
            -- érte (a feladónak egy éve volt élni az újraválasztással).
            (status IN ('pending', 'bidding')
              AND COALESCE(updated_at, created_at) < NOW() - ($1 || ' years')::interval)
            OR
            -- ⚠️ BERAGADT (2026-08-10): elkelt, akár ki is fizették, aztán
            -- megállt. Ez a leggyakoribb VALÓS kudarc-mód, és eddig egyetlen
            -- retenciós kör sem érte el — örökre őrizte a pontos címeket, a
            -- címzett elérhetőségét, az átvételi kódot és az élő
            -- követő-tokent. A disputed SZÁNDÉKOSAN kimarad: nyitott vitát
            -- nem zárhat le egy időzítő.
            (status IN ('accepted', 'in_progress')
              AND updated_at < NOW() - ($1 || ' years')::interval)
          )`,
      [ABANDONED_JOB_YEARS],
    );
    if (rowCount > 0) {
      console.log(`[retention] ${rowCount} elhagyott/beragadt fuvar lezárva (>${ABANDONED_JOB_YEARS} év)`);
    }
    return rowCount || 0;
  } catch (err) {
    console.error('[retention] elhagyott-fuvar lezárás hiba:', err.message);
    return 0;
  }
}

/**
 * Az anonimizált sorok címeinek településszintre rövidítése.
 *
 * ⚠️ 2026-08-09 (adatáramlási audit): ez korábban SQL-ben, `split_part(cim,
 * ',', 1)`-gyel történt — ami CSAK a magyar címformátumon működik. A
 * német/osztrák/román formátumban az utca áll elöl, tehát épp a pontos utca
 * és HÁZSZÁM maradt meg (lásd utils/address.js). A logika ezért JS-be került,
 * ahol tartalom alapján dönt.
 *
 * Külön körben fut, nem a nagy UPDATE-ben: így ÖNJAVÍTÓ — a korábban, a hibás
 * szabállyal anonimizált sorokat is rendbe teszi.
 *
 * @returns {Promise<number>} a javított sorok száma
 */
async function shortenAnonymizedAddresses() {
  let javitva = 0;
  try {
    for (const tabla of ['jobs', 'route_bookings']) {
      const { rows } = await db.query(
        `SELECT id, pickup_address, dropoff_address FROM ${tabla}
          WHERE anonymized_at IS NOT NULL
            AND (pickup_address IS NOT NULL OR dropoff_address IS NOT NULL)`,
      );
      for (const r of rows) {
        const felvetel = telepulesSzint(r.pickup_address) ?? '';
        const lerakas = telepulesSzint(r.dropoff_address) ?? '';
        if (felvetel === r.pickup_address && lerakas === r.dropoff_address) continue;
        await db.query(
          `UPDATE ${tabla} SET pickup_address = $2, dropoff_address = $3 WHERE id = $1`,
          [r.id, felvetel, lerakas],
        );
        javitva += 1;
      }
    }
    if (javitva > 0) {
      console.log(`[retention] ${javitva} anonimizált sor címe rövidítve településszintre`);
    }
  } catch (err) {
    console.error('[retention] cím-rövidítés hiba:', err.message);
  }
  return javitva;
}

/**
 * Járat-anonimizálás — a lejárt járatok szabad szövege és mozgásprofilja.
 *
 * ⚠️ 2026-08-09 (adatvédelmi audit, 3. kör): a `carrier_routes` egyetlen
 * retenciós körbe sem tartozott. A járat leírása és a jármű leírása szabad
 * szöveg (a szállító gyakran ír bele elérhetőséget, munkarendet, „hétfőnként
 * megyek a gyerekért Szegedre" jellegű részletet), a `waypoints` pedig évekre
 * visszamenő útvonal-előzményt őriz — ami sok soron át MOZGÁSPROFILLÁ áll
 * össze arról, hogy egy magánszemély jellemzően mikor merre jár.
 *
 * A járat TÉNYE üzletileg kell (értékelés-előzmény, statisztika, a foglalások
 * hivatkozzák), ezért itt is anonimizálunk, nem törlünk — a sor törlése
 * ráadásul kaszkádolna a foglalásokra.
 *
 * A SABLONOKAT (`is_template`) kihagyjuk: azok a szállító élő, újrahasznált
 * beállításai, nem előzmény.
 *
 * @returns {Promise<number>} az anonimizált járatok száma
 */
async function anonymizeOldCarrierRoutes() {
  try {
    const { rowCount } = await db.query(
      `UPDATE carrier_routes
          SET description = NULL,
              vehicle_description = NULL,
              -- ⚠️ A TITLE IS (2026-08-11). A beíró-pont mind a hármat AZONOSAN
              -- kezeli (ugyanaz a kapcsolat-szűrő fut rájuk), és a FUVAR-ágon
              -- épp ezért döntöttünk a title ürítése mellett — a járatnál
              -- mégis bennmaradt. Ugyanaz az érv, ugyanaz a kockázat,
              -- ellentétes végrehajtás volt.
              title = '(lejárt járat)',
              -- ⚠️ A WAYPOINTS IS (2026-08-10): a függvény saját indoklása és a
              -- 062-es migráció is a mozgásprofillal érvelt, az UPDATE mégis
              -- csak a szabad szöveget ürítette. A járat TÉNYE (cím, időpont)
              -- megmarad a title-ben; a soronkénti, azonosítható koordináta-
              -- előzményre a „statisztikai cél" gyenge jogalap.
              waypoints = '[]'::jsonb,
              anonymized_at = NOW()
        WHERE anonymized_at IS NULL
          AND is_template = FALSE
          AND departure_at IS NOT NULL
          AND departure_at < NOW() - ($1 || ' years')::interval`,
      [JOB_PII_RETENTION_YEARS],
    );
    if (rowCount > 0) {
      console.log(`[retention] ${rowCount} lejárt járat leírása anonimizálva (>${JOB_PII_RETENTION_YEARS} év)`);
    }
    return rowCount || 0;
  } catch (err) {
    console.error('[retention] járat-anonimizálás hiba:', err.message);
    return 0;
  }
}

/**
 * Lezárt viták elévülése (5 év).
 *
 * ⚠️ 2026-08-09 (adatvédelmi audit, 3. kör): a `disputes` táblának nem volt
 * megőrzési ideje. Ez azért különösen visszás, mert a vitához KÖTŐDŐ adatra
 * (fotó, chat) épp a vita miatt írtunk elő 5 évet — a `photo_retention_hold`
 * pontosan ezt a bizonyíték-zárolást jelenti. Magára a vitára viszont, ami a
 * legterheltebb szöveg az egész rendszerben (kit mivel vádolnak, mi történt,
 * milyen kárt állítanak), semmi nem vonatkozott.
 *
 * Ugyanaz az 5 év jár neki, mint a zárolt bizonyítéknak — és csak LEZÁRT
 * vitára: egy nyitott ügy sosem évül el a hátunk mögött.
 *
 * @returns {Promise<number>} a törölt viták száma
 */
async function purgeOldDisputes() {
  try {
    // A csatolt bizonyíték-fájl a tárolóban is elmegy, különben árva marad
    // (ugyanaz a hibaosztály, amit a fiók- és az admin-törlésnél zártunk le).
    const { rows } = await db.query(
      `SELECT id, evidence_url FROM disputes
        WHERE resolved_at IS NOT NULL
          AND resolved_at < NOW() - ($1 || ' years')::interval`,
      [HOLD_RETENTION_YEARS],
    );
    if (rows.length === 0) return 0;

    // ⚠️ Ugyanaz a szabály, mint a fotóknál: ha a bizonyíték-fájl törlése
    // elbukik, a vita-sort MEGTARTJUK (az az egyetlen mutató a fájlra).
    // Korábban a `try { … } catch {}` elnyelte a hibát, és a DELETE feltétel
    // nélkül lefutott — néma, végleges árva a tárolóban.
    const torolheto = [];
    let beragadtVita = 0;
    for (const d of rows) {
      if (d.evidence_url) {
        const ok = await storage.deleteFile(d.evidence_url).catch(() => false);
        if (!ok) { beragadtVita += 1; continue; }
      }
      torolheto.push(d.id);
    }
    if (beragadtVita > 0) {
      console.error(`[retention] ${beragadtVita} vita bizonyíték-fájljának törlése sikertelen — a sort MEGTARTJUK`);
      try {
        require('@sentry/node').captureMessage(
          `[retention] ${beragadtVita} vita-bizonyíték törlése sikertelen (tároló-hiba)`,
          'warning',
        );
      } catch { /* nem akaszthatja meg a kört */ }
    }
    if (torolheto.length === 0) return 0;
    const { rowCount } = await db.query(
      'DELETE FROM disputes WHERE id = ANY($1)',
      [torolheto],
    );
    console.log(`[retention] ${rowCount} lezárt vita elévült (>${HOLD_RETENTION_YEARS} év)`);
    return rowCount || 0;
  } catch (err) {
    console.error('[retention] vita-purge hiba:', err.message);
    return 0;
  }
}

/**
 * Számlák elévülése (8 év — Számv. tv. 169. § (2)).
 *
 * ⚠️ 2026-08-09 (adatvédelmi audit, 3. kör): az `invoices` a vevő NEVÉT,
 * ADÓSZÁMÁT és CÍMÉT tárolja, határidő nélkül. Itt a hosszú megőrzés nem
 * mulasztás, hanem jogszabályi kötelezettség: a számviteli bizonylatot a
 * Számv. tv. 169. § (2) szerint 8 évig meg KELL őrizni (GDPR 6. cikk (1) c) —
 * ezért ezt a kört nem is szabad rövidíteni. De nyolc év után a kötelezettség
 * megszűnik, és onnantól már csak felesleges személyes adat.
 *
 * @returns {Promise<number>} a törölt számlák száma
 */
async function purgeOldInvoices() {
  try {
    const { rowCount } = await db.query(
      `DELETE FROM invoices WHERE created_at < NOW() - ($1 || ' years')::interval`,
      [INVOICE_RETENTION_YEARS],
    );
    if (rowCount > 0) {
      console.log(`[retention] ${rowCount} számla elévült (>${INVOICE_RETENTION_YEARS} év, Számv. tv. 169. §)`);
    }
    return rowCount || 0;
  } catch (err) {
    console.error('[retention] számla-purge hiba:', err.message);
    return 0;
  }
}

/**
 * Vészhelyzeti helyadatok elévülése (SOS + mentés-kérés).
 *
 * ⚠️ 2026-08-09 (adatvédelmi audit, 2. kör): a `sos_events` és a
 * `tow_requests` egyik retenciós körbe sem tartozott — pedig ez a rendszer
 * LEGÉRZÉKENYEBB helyadata: egy vészhelyzet pontos koordinátája és időpontja,
 * szabad szöveges leírással; a mentés-kérésnél ráadásul a cím és a rendszám
 * is. Eközben a tájékoztató azt ígéri, hogy a nyers helyadatot 7 nap után
 * töröljük, és a `location_pings` / `users.last_known_*` már gépesítve is
 * van — ez a kettő maradt ki.
 *
 * A mentés-funkció jelenleg ki van kapcsolva (TOWING_ENABLED), de a job
 * MOST is fut: így amikor egyszer élesedik, az adat sosem tud felgyűlni.
 * @returns {Promise<number>} az érintett sorok száma
 */
async function purgeEmergencyLocations() {
  let erintett = 0;
  try {
    // 1) A pontos hely és a szabad szöveg 7 nap után
    const { rowCount: sosHely } = await db.query(
      `UPDATE sos_events
          SET lat = NULL, lng = NULL, message = NULL
        WHERE (lat IS NOT NULL OR lng IS NOT NULL OR message IS NOT NULL)
          AND created_at < NOW() - ($1 || ' days')::interval`,
      [SOS_LOCATION_RETENTION_DAYS],
    );
    const { rowCount: towHely } = await db.query(
      `UPDATE tow_requests
          SET address = NULL, issue_description = NULL, vehicle_plate = NULL,
              lat = 0, lng = 0
        WHERE (address IS NOT NULL OR issue_description IS NOT NULL
               OR vehicle_plate IS NOT NULL OR lat <> 0 OR lng <> 0)
          AND created_at < NOW() - ($1 || ' days')::interval`,
      [SOS_LOCATION_RETENTION_DAYS],
    );

    // 2) Maga a sor 1 év után (a vészhelyzet ténye addig megmarad)
    const { rowCount: sosSor } = await db.query(
      `DELETE FROM sos_events WHERE created_at < NOW() - ($1 || ' years')::interval`,
      [SOS_EVENT_RETENTION_YEARS],
    );
    const { rowCount: towSor } = await db.query(
      `DELETE FROM tow_requests WHERE created_at < NOW() - ($1 || ' years')::interval`,
      [SOS_EVENT_RETENTION_YEARS],
    );

    erintett = (sosHely || 0) + (towHely || 0) + (sosSor || 0) + (towSor || 0);
    if (erintett > 0) {
      console.log(`[retention] vészhelyzeti helyadat: ${(sosHely || 0) + (towHely || 0)} anonimizálva (>${SOS_LOCATION_RETENTION_DAYS} nap), ${(sosSor || 0) + (towSor || 0)} sor törölve (>${SOS_EVENT_RETENTION_YEARS} év)`);
    }
  } catch (err) {
    console.error('[retention] vészhelyzeti purge hiba:', err.message);
  }
  return erintett;
}

/**
 * A törölt fiókok audit-nyomának elévülése.
 *
 * ⚠️ 2026-08-09 (adatvédelmi audit 3. kör): a `deleted_accounts` táblára
 * SEMMILYEN retenció nem vonatkozott, és a teljes kódbázisban egyetlen
 * hivatkozás volt rá — maga az INSERT. Vagyis épp attól őriztünk határidő
 * nélkül visszaazonosítható lenyomatot, aki a törlési jogát gyakorolta.
 * @returns {Promise<number>}
 */
async function purgeOldDeletedAccounts() {
  try {
    const { rowCount } = await db.query(
      `DELETE FROM deleted_accounts WHERE deleted_at < NOW() - ($1 || ' years')::interval`,
      [DELETED_ACCOUNT_RETENTION_YEARS],
    );
    if (rowCount > 0) {
      console.log(`[retention] ${rowCount} törölt-fiók audit-nyom elévült (>${DELETED_ACCOUNT_RETENTION_YEARS} év)`);
    }
    return rowCount || 0;
  } catch (err) {
    console.error('[retention] törölt-fiók purge hiba:', err.message);
    return 0;
  }
}

/**
 * Az okmány-lenyomat előzményének elévülése (5 év).
 *
 * A tájékoztató és az érdekmérlegelési teszt II. pontosan ennyit ígér a
 * doc_number_hash csalásvédelmi megőrzésére a fiók megszűnése után. Eddig ez
 * ÜRES ígéret volt (a CASCADE azonnal törölte); most valóra váltjuk — de a
 * határidőt is betartjuk.
 */
async function purgeOldKycDocHistory() {
  try {
    const { rowCount } = await db.query(
      `DELETE FROM kyc_doc_history WHERE last_seen_at < NOW() - ($1 || ' years')::interval`,
      [HOLD_RETENTION_YEARS],
    );
    if (rowCount > 0) {
      console.log(`[retention] ${rowCount} okmány-lenyomat elévült (>${HOLD_RETENTION_YEARS} év)`);
    }
    return rowCount || 0;
  } catch (err) {
    console.error('[retention] okmány-lenyomat purge hiba:', err.message);
    return 0;
  }
}


/**
 * Beragadt JÁRAT-FOGLALÁSOK lezárása.
 *
 * ⚠️ 2026-08-10: a foglalási ágon EGYÁLTALÁN nem volt elhagyott-lezáró, tehát
 * egy `pending`/`confirmed`/`in_progress` foglalás örökre őrizte a pontos
 * címeket, a címzett elérhetőségét és az átvételi kódot. A fuvar-ág
 * megfelelője (`expireAbandonedJobs`) létezett — ez a szimmetria hiányzott.
 *
 * @returns {Promise<number>} a lezárt foglalások száma
 */
async function expireAbandonedBookings() {
  try {
    const { rowCount } = await db.query(
      `UPDATE route_bookings
          SET status = 'cancelled',
              cancel_reason = 'Automatikusan lezárva: a foglalás egy éve nem mozdult.'
        WHERE status::text NOT IN ('delivered', 'rejected', 'cancelled', 'disputed')
          AND COALESCE(delivered_at, created_at) < NOW() - ($1 || ' years')::interval`,
      [ABANDONED_JOB_YEARS],
    );
    if (rowCount > 0) {
      console.log(`[retention] ${rowCount} beragadt foglalás lezárva (>${ABANDONED_JOB_YEARS} év)`);
    }
    return rowCount || 0;
  } catch (err) {
    console.error('[retention] foglalás-lezárás hiba:', err.message);
    return 0;
  }
}

/**
 * A fizetési napló elévülése (8 év).
 *
 * ⚠️ 2026-08-10: a `payment_events` egyetlen körbe sem tartozott. Pénzügyi
 * nyom, ezért a számlákkal azonos, 8 éves megőrzést kap (Számv. tv. 169. §) —
 * de az sem lehet határtalan.
 *
 * @returns {Promise<number>}
 */
async function purgeOldPaymentEvents() {
  try {
    const { rowCount } = await db.query(
      `DELETE FROM payment_events WHERE created_at < NOW() - ($1 || ' years')::interval`,
      [INVOICE_RETENTION_YEARS],
    );
    if (rowCount > 0) {
      console.log(`[retention] ${rowCount} fizetési naplósor elévült (>${INVOICE_RETENTION_YEARS} év)`);
    }
    return rowCount || 0;
  } catch (err) {
    console.error('[retention] fizetési napló purge hiba:', err.message);
    return 0;
  }
}

// A DAC7-adatszolgáltatáshoz gyűjtött adóazonosító jel és születési dátum
// megőrzése. Pontosan annyi, amennyit az adatkezelési tájékoztató ígér.
const TAX_DATA_RETENTION_YEARS = 5;

/**
 * A fizetési tranzakció-nyom elévülése (8 év).
 *
 * ⚠️ 2026-08-10: az `escrow_transactions` egyetlen körbe sem tartozott, és a
 * retenciós manifestben TÉNYBELILEG HAMIS indoklással szerepelt kivételként
 * („az escrow-modell dormant"). A tábla valójában MINDEN kapcsolatfelvételi
 * díj-fizetéskor íródik, és a fuvar-CASCADE sosem üt be, mert a fuvart nem
 * töröljük, hanem anonimizáljuk. A számlákkal azonos, 8 éves megőrzést kap.
 *
 * @returns {Promise<number>}
 */
async function purgeOldEscrowTransactions() {
  try {
    const { rowCount } = await db.query(
      // ⚠️ A táblának NINCS `created_at` oszlopa — az időbélyeg a `held_at`
      // (ellenőrizve a sémában, nem feltételezve).
      `DELETE FROM escrow_transactions
        WHERE COALESCE(held_at, released_at, refunded_at) < NOW() - ($1 || ' years')::interval`,
      [INVOICE_RETENTION_YEARS],
    );
    if (rowCount > 0) {
      console.log(`[retention] ${rowCount} fizetési tranzakció-nyom elévült (>${INVOICE_RETENTION_YEARS} év)`);
    }
    return rowCount || 0;
  } catch (err) {
    console.error('[retention] escrow-purge hiba:', err.message);
    return 0;
  }
}

/**
 * A DAC7-adatok elévülése (5 év).
 *
 * ⚠️ 2026-08-10: a tájékoztató konkrét 5 éves megőrzést ígért az adóazonosító
 * jelre, a születési dátumra és a lakcímre — végrehajtó kód viszont NEM volt
 * hozzá. Vagyis egy kormányzati személyazonosító számot tartottunk a fiók
 * élettartamáig, írásos 5 éves vállalás mellett: a saját dokumentumunk lett
 * volna a bizonyíték a szabályszegésre.
 *
 * Az időszámítás az UTOLSÓ teljesített fuvartól indul (az adatszolgáltatási
 * kötelezettség ahhoz a jelentési évhez kötődik); ha nincs teljesített fuvar,
 * a megadás időpontjától.
 *
 * @returns {Promise<number>}
 */
async function purgeOldTaxData() {
  try {
    const { rowCount } = await db.query(
      `UPDATE users u
          SET personal_tax_id = NULL,
              birth_date = NULL,
              -- ⚠️ A LAKCÍM IS (2026-08-10): a tájékoztató ugyanabban a
              -- mondatban ígéri rá az 5 évet, a purge viszont kihagyta.
              -- Céges fióknál a billing_address a SZÁMLÁZÁSI cím, azt nem
              -- bántjuk — csak magánszemélynél DAC7-adat.
              billing_address = CASE WHEN u.account_type = 'company'
                                     THEN u.billing_address ELSE NULL END,
              tax_data_provided_at = NULL
        WHERE (u.personal_tax_id IS NOT NULL OR u.birth_date IS NOT NULL)
          AND COALESCE(
                -- A jelentési kötelezettség az UTOLSÓ teljesített fuvarhoz
                -- kötődik — a JÁRAT-foglalási ágon teljesítettekhez is.
                GREATEST(
                  (SELECT MAX(j.delivered_at) FROM jobs j WHERE j.carrier_id = u.id),
                  (SELECT MAX(b.delivered_at) FROM route_bookings b
                     JOIN carrier_routes r ON r.id = b.route_id
                    WHERE r.carrier_id = u.id)
                ),
                u.tax_data_provided_at,
                u.created_at
              ) < NOW() - ($1 || ' years')::interval`,
      [TAX_DATA_RETENTION_YEARS],
    );
    if (rowCount > 0) {
      console.log(`[retention] ${rowCount} felhasználó DAC7-adata törölve (>${TAX_DATA_RETENTION_YEARS} év)`);
    }
    return rowCount || 0;
  } catch (err) {
    console.error('[retention] DAC7-purge hiba:', err.message);
    return 0;
  }
}

/** Az összes napi retenciós kör egyben (index.js ezt ütemezi). */
async function runDailyRetention() {
  // ⚠️ MEGFIGYELHETŐSÉG (2026-08-10, séma-audit): korábban minden purge
  // lenyelte a saját hibáját, az ütemező pedig `.catch(() => {})`-tal hívott.
  // Ha a kör hónapokig elszállt, azt SEMMI nem jelezte, és utólag bizonyítani
  // sem lehetett, hogy valaha lefutott. A GDPR 5. cikk (2) épp ezt kéri:
  // nem elég betartani a megőrzési időket, bizonyítani is kell tudni.
  //
  // Mostantól: minden kör eredménye naplóba kerül (személyes adat NÉLKÜL:
  // mit futtattunk, mikor, hány sort érintett), a hiba pedig Sentry-riasztást
  // kap — ugyanúgy, ahogy az SMS-kiesés (sms.js reportSmsFailure).
  // Egy kör hibája NEM állítja meg a többit: mindegyik külön fut.
  // A köröket NÉV szerint hívjuk a modul-exportról: így egy teszt le tudja
  // cserélni bármelyiket (a belső hivatkozást nem lehetne), és a retenciós őr
  // is látja a neveket a forrásban.
  const KOR_NEVEK = [
    'purgeOldDeliveryPhotos',
    'purgeOldChatMessages',
    'purgeOldLocationPings',
    'purgeStaleLastKnownLocation',
    'purgeOldNotifications',
    'purgeOldAdminMessages',
    'purgeOldAdminAccessLog',
    'expireAbandonedJobs',
    'expireAbandonedBookings',
    'repairDisputedHold',
    'anonymizeOldJobs',
    'anonymizeOldCarrierRoutes',
    'purgeOldDisputes',
    'purgeOldInvoices',
    'purgeEmergencyLocations',
    'purgeOldDeletedAccounts',
    'purgeOldKycDocHistory',
    'purgeOldPaymentEvents',
    'purgeOldEscrowTransactions',
    'purgeOldTaxData',
    'purgeDormantAccounts',
  ];

  const eredmeny = {};
  const hibak = {};

  for (const nev of KOR_NEVEK) {
    try {
      eredmeny[nev] = (await module.exports[nev]()) || 0;
    } catch (err) {
      // Ide csak akkor jutunk, ha a kör SAJÁT kezelése is elhasalt.
      // ⚠️ A HIBAÜZENET MASZKOLVA (2026-08-11, 9. mérés R1). A futás-naplót
        // HATÁRIDŐ NÉLKÜL őrizzük, azzal az indoklással, hogy „személyes adatot
        // nem tartalmaz" — ez eddig ÁLLÍTÁS volt, nem garancia. A Postgres
        // hibaüzenetek viszont visszhangozhatnak adat-részletet
        // (`invalid input syntax for type uuid: "..."`). Most kikényszerítjük.
        hibak[nev] = require('../utils/mask').maskInText(err.message);
      console.error(`[retention] ${nev} elszállt:`, err.message);
    }
  }

  const ok = Object.keys(hibak).length === 0;

  try {
    await db.query(
      `INSERT INTO retention_runs (finished_at, eredmeny, hibak, ok)
       VALUES (NOW(), $1::jsonb, $2::jsonb, $3)`,
      [JSON.stringify(eredmeny), JSON.stringify(hibak), ok],
    );
  } catch (err) {
    console.error('[retention] a futás-napló írása sikertelen:', err.message);
  }

  if (!ok) {
    try {
      const Sentry = require('@sentry/node');
      Sentry.captureMessage(
        `[retention] ${Object.keys(hibak).length} retenciós kör elszállt: ${Object.keys(hibak).join(', ')}`,
        'error',
      );
    } catch { /* a riasztás hiánya nem akaszthatja meg a kört */ }
  }

  return { eredmeny, hibak, ok };
}

/**
 * Mikor futott le UTOLJÁRA hibátlanul a napi kör?
 * Az elszámoltathatóság bizonyítéka — és az alapja annak, hogy egy néma
 * kiesés észrevehető legyen.
 */
async function lastSuccessfulRetentionRun() {
  try {
    const { rows } = await db.query(
      `SELECT started_at, finished_at, eredmeny FROM retention_runs
        WHERE ok = TRUE ORDER BY started_at DESC LIMIT 1`,
    );
    return rows[0] || null;
  } catch (err) {
    console.error('[retention] futás-napló olvasás hiba:', err.message);
    return null;
  }
}

module.exports = {
  purgeDormantAccounts, DORMANT_WARN_YEARS, DORMANT_DELETE_DAYS,
  repairDisputedHold,
  purgeOldDeliveryPhotos, purgeOldChatMessages, purgeOldLocationPings,
  purgeStaleLastKnownLocation, purgeOldNotifications,
  purgeOldAdminMessages, purgeOldAdminAccessLog, anonymizeOldJobs,
  shortenAnonymizedAddresses, expireAbandonedJobs, expireAbandonedBookings,
  purgeOldPaymentEvents, purgeOldEscrowTransactions, purgeOldTaxData, TAX_DATA_RETENTION_YEARS, ABANDONED_JOB_YEARS,
  anonymizeOldCarrierRoutes, purgeOldDisputes, purgeOldInvoices,
  lastSuccessfulRetentionRun,
  purgeEmergencyLocations, purgeOldDeletedAccounts, purgeOldKycDocHistory, runDailyRetention,
  DELETED_ACCOUNT_RETENTION_YEARS, PHOTO_KINDS, INVOICE_RETENTION_YEARS,
  SOS_LOCATION_RETENTION_DAYS, SOS_EVENT_RETENTION_YEARS,
  JOB_PII_RETENTION_YEARS,
  ADMIN_ACCESS_LOG_RETENTION_YEARS,
  NOTIFICATION_RETENTION_MONTHS,
  DEFAULT_RETENTION_DAYS, HOLD_RETENTION_YEARS, CHAT_RETENTION_MONTHS, GPS_RETENTION_DAYS,
  ADMIN_DM_RETENTION_YEARS,
};
