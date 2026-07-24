// DAC7 (Aktv.) platformüzemeltetői átvilágítás — magánszemély szállítók
// adóazonosító jelének progresszív bekérése.
//
// A GoFuvar az Aktv. szerint platformüzemeltető, a szállítók „értékesítők"
// (személyi szolgáltatás: fuvarozás — NINCS de minimis mentesség: már 1
// teljesített fuvar jelentendővé tesz). A kötelező adatkör magánszemélynél:
// név (KYC-ből megvan), lakcím, születési dátum, ADÓAZONOSÍTÓ JEL — ez
// utóbbiakat itt gyűjtjük. Cégnél a TIN az adószám (tax_id, már gyűjtött).
//
// A bekérés a Vinted/Airbnb-mintát követi (konverzió-kímélő):
//   1) Regisztráció + KYC + ajánlattétel adóazonosító NÉLKÜL megy.
//   2) Az ELSŐ teljesített fuvar után (amikor a szállító jelentendővé
//      válik) beáll a tax_data_requested_at + értesítés/email megy.
//   3) 21 és 42 nap múlva emlékeztető email (napi job küldi).
//   4) 2 emlékeztető + 60 nap után az ÚJ ajánlattétel blokkolódik
//      (TAX_DATA_REQUIRED) — ez a törvény által előírt kikényszerítés
//      (nálunk a fiók-korlátozás az eszköz, kifizetést nem tartunk vissza,
//      mert a fuvardíj nem a platformon folyik).
//
// A NAV felé történő éves adatszolgáltatás (első: a launch-évet követő
// január 31.) KÜLÖN lépés — ez a modul csak az adatgyűjtést fedi.

const db = require('../db');
const { createNotification } = require('./notifications');
const { sendTaxDataRequestEmail } = require('./email');

const DEADLINE_DAYS = 60;
const REMINDER_INTERVAL_DAYS = 21;
const MAX_REMINDERS = 2;

/**
 * Magyar adóazonosító jel ellenőrzés: 10 számjegy, 8-cal kezdődik,
 * az utolsó jegy ellenőrző összeg: sum(jegy_i * i, i=1..9) mod 11.
 * (Ha a mod 11 eredménye 10 lenne, olyan szám nincs kiadva.)
 */
function validatePersonalTaxId(value) {
  const s = String(value ?? '').replace(/\s/g, '');
  if (!/^8\d{9}$/.test(s)) return false;
  let sum = 0;
  for (let i = 0; i < 9; i++) sum += Number(s[i]) * (i + 1);
  const check = sum % 11;
  if (check === 10) return false;
  return check === Number(s[9]);
}

/**
 * A user DAC7-állapota a users-sor mezőiből. UI-nak és a kapunak közös
 * igazságforrás.
 * @returns {{needed: boolean, blocked: boolean, deadline: string|null}}
 */
function computeTaxDataState(u) {
  if (!u || u.account_type === 'company' || u.personal_tax_id || !u.tax_data_requested_at) {
    return { needed: false, blocked: false, deadline: null };
  }
  const requestedAt = new Date(u.tax_data_requested_at);
  const deadline = new Date(requestedAt.getTime() + DEADLINE_DAYS * 86400000);
  const blocked = (u.tax_data_reminder_count ?? 0) >= MAX_REMINDERS && Date.now() > deadline.getTime();
  return { needed: true, blocked, deadline: deadline.toISOString() };
}

/**
 * Az első teljesített fuvar utáni trigger: ha a szállító magánszemély és
 * még nincs adóazonosítója ÉS még nem kértük, beállítja a
 * tax_data_requested_at-ot + értesítést és emailt küld. Idempotens,
 * best-effort (sosem dob) — a lezárás-flow fire-and-forget hívja.
 */
async function markTaxDataRequestedIfNeeded(carrierId) {
  try {
    if (!carrierId) return;
    const { rows } = await db.query(
      `UPDATE users SET tax_data_requested_at = NOW()
        WHERE id = $1 AND account_type = 'individual'
          AND personal_tax_id IS NULL AND tax_data_requested_at IS NULL
        RETURNING email, full_name, tax_data_requested_at`,
      [carrierId],
    );
    const u = rows[0];
    if (!u) return; // céges / már megadta / már kértük

    const deadline = new Date(Date.parse(u.tax_data_requested_at) + DEADLINE_DAYS * 86400000);
    await createNotification({
      user_id: carrierId,
      type: 'tax_data_request',
      title: '🧾 Add meg az adóazonosító jeled',
      body: 'Gratulálunk az első teljesített fuvarodhoz! Jogszabályi kötelezettségünk (DAC7) a szállítók adóügyi adatainak rögzítése — kérjük, add meg az adóazonosító jeled, születési dátumod és lakcímed a profilodon.',
      link: '/profil',
    }).catch(() => {});
    sendTaxDataRequestEmail({
      to: u.email,
      name: u.full_name,
      deadline,
      reminderNo: 0,
    }).catch(() => {});
  } catch (e) {
    console.warn('[dac7] request-jelölés hiba:', e.message);
  }
}

/**
 * Napi emlékeztető-kör: 21 naponta, összesen 2 emlékeztető azoknak, akik
 * a kérés után sem adták meg az adataikat. A 2. emlékeztető + 60 nap után
 * a kapu (requireDriverKYC) blokkol — erről a 2. email előre szól.
 */
async function runDailyDac7Reminders() {
  const { rows } = await db.query(
    `UPDATE users SET tax_data_reminder_count = tax_data_reminder_count + 1,
            tax_data_last_reminder_at = NOW()
      WHERE account_type = 'individual'
        AND personal_tax_id IS NULL
        AND tax_data_requested_at IS NOT NULL
        AND tax_data_reminder_count < $1
        AND COALESCE(tax_data_last_reminder_at, tax_data_requested_at)
              < NOW() - ($2 || ' days')::interval
      RETURNING id, email, full_name, tax_data_requested_at, tax_data_reminder_count`,
    [MAX_REMINDERS, REMINDER_INTERVAL_DAYS],
  );
  for (const u of rows) {
    const deadline = new Date(Date.parse(u.tax_data_requested_at) + DEADLINE_DAYS * 86400000);
    createNotification({
      user_id: u.id,
      type: 'tax_data_reminder',
      title: '🧾 Emlékeztető: adóazonosító jel szükséges',
      body: u.tax_data_reminder_count >= MAX_REMINDERS
        ? `Utolsó emlékeztető: ha ${deadline.toLocaleDateString('hu-HU')}-ig nem adod meg az adóazonosító jeled a profilodon, az új ajánlattétel felfüggesztésre kerül (jogszabályi kötelezettség, DAC7).`
        : 'Kérjük, add meg az adóazonosító jeled, születési dátumod és lakcímed a profilodon (jogszabályi kötelezettség, DAC7).',
      link: '/profil',
    }).catch(() => {});
    sendTaxDataRequestEmail({
      to: u.email,
      name: u.full_name,
      deadline,
      reminderNo: u.tax_data_reminder_count,
    }).catch(() => {});
  }
  if (rows.length) console.log(`[dac7] ${rows.length} adóazonosító-emlékeztető kiküldve`);
  return rows.length;
}

module.exports = {
  validatePersonalTaxId,
  computeTaxDataState,
  markTaxDataRequestedIfNeeded,
  runDailyDac7Reminders,
  DEADLINE_DAYS,
  REMINDER_INTERVAL_DAYS,
  MAX_REMINDERS,
};
