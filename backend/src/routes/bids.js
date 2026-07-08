// Licit (Bid) végpontok + escrow letét szimuláció.
const express = require('express');
const db = require('../db');
const { authRequired, requireDriverKYC } = require('../middleware/auth');
const realtime = require('../realtime');
const paymentProvider = require('../services/paymentProvider');
const { createNotification } = require('../services/notifications');
const { writeRateLimit } = require('../middleware/rateLimit');
const { sendBidReceivedEmail, sendBidAcceptedEmail } = require('../services/email');
const { convertEurToHuf, convertHufToEur, freezeExchangeRate } = require('../services/exchange');
const { getJobParty } = require('../utils/jobAccess');
const { calculateConnectionFee } = require('../services/connectionFee');

const router = express.Router();

// GET /bids/preview — licit előnézet.
// Készpénzes modell: a sofőr a TELJES összeget kézhez kapja (készpénzben,
// levonás nélkül); a platformFee a feladó által fizetendő kapcsolatfelvételi
// díj (tájékoztató jelleggel adjuk vissza).
router.get('/bids/preview', authRequired, async (req, res) => {
  const { amount, currency = 'HUF', job_currency } = req.query;
  const amt = Number(amount);
  if (!amt || amt <= 0) {
    return res.status(400).json({ error: 'Érvénytelen összeg' });
  }
  const result = {
    amount: amt,
    currency,
    platformFee: calculateConnectionFee(amt),
    netPayout: amt,
    cashPayment: true,
  };

  // Ha a fuvar EUR-ban van de a sofőr HUF-ban akar licitálni (vagy fordítva)
  if (job_currency && job_currency !== currency) {
    if (currency === 'EUR' && job_currency === 'HUF') {
      const conv = await convertEurToHuf(amt);
      result.convertedAmount = conv.hufAmount;
      result.convertedCurrency = 'HUF';
      result.exchangeRate = conv.rate;
    } else if (currency === 'HUF' && job_currency === 'EUR') {
      const conv = await convertHufToEur(amt);
      result.convertedAmount = conv.eurAmount;
      result.convertedCurrency = 'EUR';
      result.exchangeRate = conv.rate;
    }
  }

  res.json(result);
});

// GET /bids/mine – a bejelentkezett felhasználó összes leadott licitje
//   (bárki lehet most már licitáló, nem csak "carrier" role).
router.get('/bids/mine', authRequired, async (req, res) => {
  const { rows } = await db.query(
    `SELECT
        b.id              AS bid_id,
        b.amount_huf,
        b.eta_minutes,
        b.message,
        b.status          AS bid_status,
        b.created_at      AS bid_created_at,
        j.id              AS job_id,
        j.title           AS job_title,
        j.status          AS job_status,
        j.pickup_address,
        j.dropoff_address,
        j.distance_km,
        j.suggested_price_huf,
        j.accepted_price_huf,
        j.carrier_id      AS job_carrier_id
       FROM bids b
       JOIN jobs j ON j.id = b.job_id
      WHERE b.carrier_id = $1
      ORDER BY b.created_at DESC`,
    [req.user.sub],
  );
  res.json(rows);
});

// POST /jobs/:jobId/bids – bárki licitálhat egy fuvarra, kivéve ha ő a feladója
// Támogatja a multi-currency-t: a sofőr a fuvar valutájában VAGY a sajátjában licitálhat
router.post('/jobs/:jobId/bids', authRequired, requireDriverKYC, writeRateLimit, async (req, res) => {
  const { jobId } = req.params;
  const { amount_huf, amount, currency, message, eta_minutes, return_policy, return_fee_huf } = req.body || {};
  // Backward compat: amount_huf VAGY az új amount + currency páros
  const bidAmount = amount || amount_huf;
  const bidCurrency = currency || 'HUF';

  // Visszaszállítási nyilatkozat (sikertelen kézbesítés esetén): kötelező.
  // 'included' = benne van az ajánlatban, 'extra_fee' = külön díjért
  // (return_fee_huf), 'no' = nem vállalja.
  const RETURN_POLICIES = ['included', 'extra_fee', 'no'];
  if (!RETURN_POLICIES.includes(return_policy)) {
    return res.status(400).json({
      error: 'Nyilatkozz a sikertelen kézbesítés esetén történő visszaszállításról.',
      code: 'RETURN_POLICY_REQUIRED',
    });
  }
  let returnFeeClean = null;
  if (return_policy === 'extra_fee') {
    const fee = Number(return_fee_huf);
    if (!Number.isInteger(fee) || fee <= 0 || fee > 100000000) {
      return res.status(400).json({
        error: 'A visszaszállítás külön díját pozitív egész számként add meg (forintban).',
        code: 'RETURN_FEE_INVALID',
      });
    }
    returnFeeClean = fee;
  }
  // Egész szám validáció: az amount_huf INTEGER oszlop. Tizedes ("100.99")
  // vagy nem-numerikus ("5000; DROP") érték a DB-ig jutva integer-hibát
  // dobna → 500 + a DB belső hibaüzenet kiszivárogna. Itt szűrjük előbb.
  const numAmount = Number(bidAmount);
  if (!Number.isInteger(numAmount) || numAmount <= 0) {
    return res.status(400).json({ error: 'Az összeg csak pozitív egész szám lehet (forintban).' });
  }
  // Felső korlát: az amount_huf INTEGER (max ~2,1 milliárd), efölött a DB
  // "value out of range" hibát dobna → 500. 100 millió bőven elég bármilyen
  // valós fuvardíjhoz; efölött elgépelés (pl. túl sok nulla).
  const MAX_BID = 100000000;
  if (numAmount > MAX_BID) {
    return res.status(400).json({ error: 'A megadott összeg irreálisan magas (legfeljebb 100 000 000 Ft).' });
  }

  const { rows: jobRows } = await db.query(
    'SELECT status, shipper_id, currency AS job_currency FROM jobs WHERE id = $1',
    [jobId],
  );
  if (!jobRows[0]) return res.status(404).json({ error: 'Fuvar nem található' });
  if (jobRows[0].shipper_id === req.user.sub) {
    return res.status(403).json({ error: 'A saját fuvarodra nem licitálhatsz.' });
  }
  if (!['pending', 'bidding'].includes(jobRows[0].status)) {
    return res.status(409).json({ error: 'A fuvarra már nem lehet licitálni' });
  }

  // Jogosítvány-követelmény megszűnt (2026-07-07): a személyi igazolvány +
  // a sofőri nyilatkozat (requireDriverKYC) elég; a can_bid/license-kapu kivéve.

  try {
    // Árfolyam befagyasztás ha cross-currency licit
    let exchangeRate = null;
    let exchangeFrozenAt = null;
    const jobCurrency = jobRows[0].job_currency || 'HUF';
    if (bidCurrency !== jobCurrency) {
      const frozen = await freezeExchangeRate();
      exchangeRate = frozen.rate;
      exchangeFrozenAt = frozen.frozenAt;
    }

    const { rows } = await db.query(
      `INSERT INTO bids (job_id, carrier_id, amount_huf, currency, exchange_rate, exchange_rate_frozen_at, message, eta_minutes, return_policy, return_fee_huf)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING *`,
      [jobId, req.user.sub, numAmount, bidCurrency, exchangeRate, exchangeFrozenAt, message || null, eta_minutes || null, return_policy, returnFeeClean],
    );
    realtime.emitToJob(jobId, 'bids:new', rows[0]);

    // Értesítés a feladónak: új licit érkezett (in-app + email)
    try {
      const { rows: jRows } = await db.query(
        `SELECT j.shipper_id, j.title,
                s.email AS shipper_email, s.full_name AS shipper_name,
                u.full_name AS carrier_name
           FROM jobs j
           JOIN users s ON s.id = j.shipper_id
           JOIN users u ON u.id = $2
          WHERE j.id = $1`,
        [jobId, req.user.sub],
      );
      if (jRows[0]) {
        const info = jRows[0];
        await createNotification({
          user_id: info.shipper_id,
          type: 'bid_received',
          title: 'Új licit érkezett 🎯',
          body: `${info.carrier_name} ${numAmount.toLocaleString('hu-HU')} Ft ajánlatot tett a(z) "${info.title}" fuvaradra.`,
          link: `/dashboard/fuvar/${jobId}`,
        });
        // Email is, fire-and-forget (ne blokkolja a választ)
        setImmediate(() => {
          sendBidReceivedEmail({
            to: info.shipper_email,
            shipperName: info.shipper_name,
            jobTitle: info.title,
            jobId,
            carrierName: info.carrier_name,
            amountHuf: numAmount,
          }).catch((e) => console.warn('[email] bid_received hiba:', e.message));
        });
      }
    } catch (e) {
      console.warn('[notifications] bid_received hiba:', e.message);
    }

    res.status(201).json(rows[0]);
  } catch (err) {
    if (err.code === '23505') return res.status(409).json({ error: 'Már licitáltál erre a fuvarra' });
    throw err;
  }
});

// GET /jobs/:jobId/bids
// IDOR-védelem: a feladó és admin minden licitet lát; egy sofőr CSAK a saját
// licitjét látja (más sofőr ajánlatát ne tudja kiolvasni). A frontend sofőr-
// oldal Promise.all-ban kéri, ezért 403 helyett szűrt 200-at adunk vissza.
router.get('/jobs/:jobId/bids', authRequired, async (req, res) => {
  const { notFound, isShipper, isAdmin } = await getJobParty(req.params.jobId, req.user);
  if (notFound) return res.status(404).json({ error: 'Fuvar nem található' });

  const seeAll = isShipper || isAdmin;
  const { rows } = await db.query(
    `SELECT b.*, b.currency AS bid_currency, b.exchange_rate,
            u.full_name AS carrier_name, u.avatar_url AS carrier_avatar,
            u.rating_avg, u.rating_count,
            u.trust_score, u.is_verified_carrier,
            u.vehicle_type AS carrier_vehicle
       FROM bids b JOIN users u ON u.id = b.carrier_id
      WHERE b.job_id = $1 ${seeAll ? '' : 'AND b.carrier_id = $2'}
      ORDER BY b.amount_huf ASC`,
    seeAll ? [req.params.jobId] : [req.params.jobId, req.user.sub],
  );
  // Készpénzes modell: a sofőr a teljes összeget kapja (kápé, levonás
  // nélkül); a platform_fee a feladó kapcsolatfelvételi díja ehhez a
  // licit-összeghez.
  const enriched = rows.map((b) => ({
    ...b,
    platform_fee: calculateConnectionFee(b.amount_huf || 0),
    net_payout: b.amount_huf,
  }));
  res.json(enriched);
});

// Az alku/elfogadás közös magja: a megállapodott áron (agreedPrice) lezárja
// a licitet — beállítja a job-ot, a többi licitet elutasítja, és elindítja a
// KAPCSOLATFELVÉTELI DÍJ fizetését (készpénzes modell: a fuvardíj kápéban
// megy a sofőrnek, a platform csak a saját díját szedi be a feladótól).
// Tranzakción BELÜL fut (a hívó nyitja/zárja).
//
// Díjmentes újraválasztás: ha a fuvaron a díj MÁR ki van fizetve (paid_at —
// egy korábbi sofőrrel meghiúsult a fuvar és a feladó újat választ), nem
// indítunk új fizetést: a díj a fuvarra szól, egyszeri.
//
// Visszaad: { ok:true, barionRes, feeHuf, feeAlreadyPaid } VAGY
//           { ok:false, status, error, detail? } — ekkor a hívó ROLLBACK-el.
async function finalizeAcceptedBid(client, bid, agreedPrice) {
  await client.query(`UPDATE bids SET status = 'accepted' WHERE id = $1`, [bid.id]);
  await client.query(
    `UPDATE bids SET status = 'rejected' WHERE job_id = $1 AND id <> $2 AND status = 'pending'`,
    [bid.job_id, bid.id],
  );
  const feeAlreadyPaid = !!bid.paid_at;
  // A díj a fuvarra egyszer rögzül: újraválasztásnál a korábban kifizetett
  // díj marad érvényben, akkor is ha az új megállapodott ár más sávba esne.
  const feeHuf = feeAlreadyPaid && bid.connection_fee_huf
    ? bid.connection_fee_huf
    : calculateConnectionFee(agreedPrice);
  // Státusz-guard: a job sorát nem zárolja a hívó SELECT-je, ezért a
  // WHERE-feltétel + rowCount dönti el, ki nyert párhuzamos elfogadásnál.
  const jobClaim = await client.query(
    `UPDATE jobs SET status = 'accepted', carrier_id = $1, accepted_price_huf = $2,
            connection_fee_huf = $3, updated_at = NOW()
      WHERE id = $4 AND status IN ('pending', 'bidding')`,
    [bid.carrier_id, agreedPrice, feeHuf, bid.job_id],
  );
  if (jobClaim.rowCount === 0) {
    return { ok: false, status: 409, error: 'A fuvar már nem elfogadható (időközben elfogadtak egy másik licitet).' };
  }

  if (feeAlreadyPaid) {
    return { ok: true, barionRes: { paymentId: null, gatewayUrl: null }, feeHuf, feeAlreadyPaid: true };
  }

  let barionRes = { paymentId: null, gatewayUrl: null };
  try {
    barionRes = await paymentProvider.startFeePayment({
      jobId: bid.job_id,
      feeHuf,
      shipperEmail: bid.shipper_email,
    });
  } catch (err) {
    console.error('[barion] startFeePayment hiba:', err.message);
    return { ok: false, status: 502, error: 'A díjfizetés indítása sikertelen', detail: err.message };
  }
  // A fizetés-nyilvántartás az escrow_transactions táblában marad, de a sor
  // mostantól a kapcsolatfelvételi díjat könyveli: amount = díj,
  // carrier_share = 0 (a sofőr kápéban kap, nem rajtunk keresztül),
  // platform_share = a teljes díj.
  await client.query(
    `INSERT INTO escrow_transactions
       (job_id, amount_huf, status, barion_payment_id, barion_gateway_url,
        carrier_share_huf, platform_share_huf)
     VALUES ($1,$2,'held',$3,$4,0,$2)
     ON CONFLICT (job_id) DO UPDATE SET
       amount_huf         = EXCLUDED.amount_huf,
       status             = 'held',
       barion_payment_id  = EXCLUDED.barion_payment_id,
       barion_gateway_url = EXCLUDED.barion_gateway_url,
       carrier_share_huf  = 0,
       platform_share_huf = EXCLUDED.platform_share_huf,
       held_at            = NOW()
       -- Védelem: már kifizetett díjat SOHA ne írjunk vissza 'held'-re
       -- (normál folyamatban ez az ág nem fut, mert a paid_at guard véd;
       -- ez biztonsági háló egy esetleges re-listázás ellen).
       WHERE escrow_transactions.status = 'held'`,
    [bid.job_id, feeHuf, barionRes.paymentId, barionRes.gatewayUrl],
  );
  return { ok: true, barionRes, feeHuf, feeAlreadyPaid: false };
}

// Megállapodás-értesítések. acceptedBy: 'shipper' (a feladó fogadott el egy
// licitet/sofőr-ellenajánlatot) vagy 'carrier' (a sofőr fogadta el a feladó
// ellenajánlatát). Soha nem dob.
async function notifyDealClosed(bid, agreedPrice, acceptedBy) {
  try {
    const { rows } = await db.query(
      `SELECT j.title, c.full_name AS carrier_name, c.email AS carrier_email
         FROM jobs j JOIN users c ON c.id = $2 WHERE j.id = $1`,
      [bid.job_id, bid.carrier_id],
    );
    const info = rows[0] || {};
    const priceTxt = Number(agreedPrice).toLocaleString('hu-HU');
    await createNotification({
      user_id: bid.carrier_id,
      type: 'bid_accepted',
      title: '🎉 Megállapodás!',
      body: acceptedBy === 'carrier'
        ? `Elfogadtad a feladó ellenajánlatát — a(z) "${info.title || 'fuvar'}" fuvar a tiéd ${priceTxt} Ft-ért, KÉSZPÉNZBEN kapod. A feladó most fizeti a kapcsolatfelvételi díjat, utána megkapjátok egymás elérhetőségét és indulhatsz.`
        : `A(z) "${info.title || 'fuvar'}" licitedet elfogadták ${priceTxt} Ft-ért — a teljes összeget KÉSZPÉNZBEN kapod. Amint a feladó fizeti a kapcsolatfelvételi díjat, megkapjátok egymás elérhetőségét.`,
      link: `/sofor/fuvar/${bid.job_id}`,
    });
    if (info.carrier_email) {
      setImmediate(() => {
        sendBidAcceptedEmail({
          to: info.carrier_email,
          carrierName: info.carrier_name,
          jobTitle: info.title,
          jobId: bid.job_id,
          amountHuf: agreedPrice,
        }).catch((e) => console.warn('[email] bid_accepted hiba:', e.message));
      });
    }
    // Ha a sofőr fogadta el a feladó ellenajánlatát, a feladót kell fizetésre szólítani
    if (acceptedBy === 'carrier') {
      await createNotification({
        user_id: bid.shipper_id,
        type: 'counter_accepted',
        title: '✅ Elfogadták az ellenajánlatodat',
        body: `A sofőr elfogadta a(z) "${info.title || 'fuvar'}" fuvarra tett ${priceTxt} Ft-os ellenajánlatodat. Fizesd meg a kapcsolatfelvételi díjat a folytatáshoz — a fuvardíjat készpénzben adod majd a sofőrnek.`,
        link: `/dashboard/fuvar/${bid.job_id}`,
      });
    }
  } catch (e) {
    console.warn('[notifications] deal_closed hiba:', e.message);
  }
}

// POST /bids/:id/accept – a fuvar FELADÓJA elfogadja a licitet (vagy a sofőr
// legutóbbi ellenajánlatát) → ESCROW lefoglalás a megállapodott áron.
router.post('/bids/:id/accept', authRequired, writeRateLimit, async (req, res) => {
  const client = await db.pool.connect();
  try {
    await client.query('BEGIN');
    const { rows: bidRows } = await client.query(
      `SELECT b.*, j.shipper_id, j.status AS job_status,
              j.paid_at, j.connection_fee_huf,
              s.email AS shipper_email,
              c.email AS carrier_email
         FROM bids b
         JOIN jobs j  ON j.id = b.job_id
         JOIN users s ON s.id = j.shipper_id
         JOIN users c ON c.id = b.carrier_id
        WHERE b.id = $1 FOR UPDATE`,
      [req.params.id],
    );
    const bid = bidRows[0];
    if (!bid) { await client.query('ROLLBACK'); return res.status(404).json({ error: 'Licit nem található' }); }
    if (bid.shipper_id !== req.user.sub) {
      await client.query('ROLLBACK'); return res.status(403).json({ error: 'Nincs jogosultság' });
    }
    if (!['pending', 'bidding'].includes(bid.job_status)) {
      await client.query('ROLLBACK'); return res.status(409).json({ error: 'A fuvar már nem elfogadható' });
    }
    if (bid.status !== 'pending') {
      await client.query('ROLLBACK'); return res.status(409).json({ error: 'Ez a licit már nem aktív.' });
    }
    // Ha a feladó tett ellenajánlatot, ami még válaszra vár, ő nem fogadhat el —
    // a labda a sofőrnél van.
    if (bid.counter_by === 'shipper' && bid.counter_amount_huf != null) {
      await client.query('ROLLBACK');
      return res.status(409).json({ error: 'A sofőr még nem reagált az ellenajánlatodra.' });
    }
    // Megállapodott ár: ha a sofőr tett ellenajánlatot, azt fogadjuk el; különben az eredeti licit.
    const agreedPrice = (bid.counter_by === 'carrier' && bid.counter_amount_huf != null)
      ? bid.counter_amount_huf : bid.amount_huf;

    const fin = await finalizeAcceptedBid(client, bid, agreedPrice);
    if (!fin.ok) {
      await client.query('ROLLBACK');
      return res.status(fin.status).json({ error: fin.error, ...(fin.detail ? { detail: fin.detail } : {}) });
    }
    await client.query('COMMIT');

    realtime.emitToJob(bid.job_id, 'job:accepted', {
      job_id: bid.job_id, carrier_id: bid.carrier_id,
      amount_huf: agreedPrice, barion_gateway_url: fin.barionRes.gatewayUrl,
    });
    notifyDealClosed(bid, agreedPrice, 'shipper');

    res.json({
      ok: true, job_id: bid.job_id, carrier_id: bid.carrier_id, amount_huf: agreedPrice,
      connection_fee_huf: fin.feeHuf,
      fee_already_paid: !!fin.feeAlreadyPaid,
      barion: {
        payment_id: fin.barionRes.paymentId, gateway_url: fin.barionRes.gatewayUrl,
      },
    });
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
});

// POST /bids/:id/accept-counter – a SOFŐR elfogadja a feladó ellenajánlatát.
router.post('/bids/:id/accept-counter', authRequired, writeRateLimit, async (req, res) => {
  const client = await db.pool.connect();
  try {
    await client.query('BEGIN');
    const { rows: bidRows } = await client.query(
      `SELECT b.*, j.shipper_id, j.status AS job_status,
              j.paid_at, j.connection_fee_huf,
              s.email AS shipper_email, c.email AS carrier_email
         FROM bids b
         JOIN jobs j  ON j.id = b.job_id
         JOIN users s ON s.id = j.shipper_id
         JOIN users c ON c.id = b.carrier_id
        WHERE b.id = $1 FOR UPDATE`,
      [req.params.id],
    );
    const bid = bidRows[0];
    if (!bid) { await client.query('ROLLBACK'); return res.status(404).json({ error: 'Licit nem található' }); }
    if (bid.carrier_id !== req.user.sub) {
      await client.query('ROLLBACK'); return res.status(403).json({ error: 'Nincs jogosultság' });
    }
    if (!['pending', 'bidding'].includes(bid.job_status)) {
      await client.query('ROLLBACK'); return res.status(409).json({ error: 'A fuvar már nem elfogadható' });
    }
    if (bid.status !== 'pending') {
      await client.query('ROLLBACK'); return res.status(409).json({ error: 'Ez a licit már nem aktív.' });
    }
    if (bid.counter_by !== 'shipper' || bid.counter_amount_huf == null) {
      await client.query('ROLLBACK'); return res.status(409).json({ error: 'Nincs elfogadható feladói ellenajánlat.' });
    }
    const agreedPrice = bid.counter_amount_huf;

    const fin = await finalizeAcceptedBid(client, bid, agreedPrice);
    if (!fin.ok) {
      await client.query('ROLLBACK');
      return res.status(fin.status).json({ error: fin.error, ...(fin.detail ? { detail: fin.detail } : {}) });
    }
    await client.query('COMMIT');

    realtime.emitToJob(bid.job_id, 'job:accepted', {
      job_id: bid.job_id, carrier_id: bid.carrier_id,
      amount_huf: agreedPrice, barion_gateway_url: fin.barionRes.gatewayUrl,
    });
    notifyDealClosed(bid, agreedPrice, 'carrier');

    res.json({ ok: true, job_id: bid.job_id, amount_huf: agreedPrice });
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
});

// POST /bids/:id/counter – ellenajánlat a licit összegére. Mindkét fél teheti
// (feladó vagy az adott licit sofőrje). A legutóbbi ellenajánlat felülírja az
// előzőt; a másik fél elfogadhatja (accept / accept-counter) vagy visszadobhat.
router.post('/bids/:id/counter', authRequired, writeRateLimit, async (req, res) => {
  const amt = Number(req.body?.amount);
  if (!Number.isInteger(amt) || amt <= 0 || amt > 100000000) {
    return res.status(400).json({ error: 'Érvénytelen összeg.' });
  }
  const { rows } = await db.query(
    `SELECT b.id, b.carrier_id, b.status AS bid_status, b.job_id,
            j.shipper_id, j.status AS job_status, j.title
       FROM bids b JOIN jobs j ON j.id = b.job_id
      WHERE b.id = $1`,
    [req.params.id],
  );
  const bid = rows[0];
  if (!bid) return res.status(404).json({ error: 'Licit nem található' });
  const isShipper = bid.shipper_id === req.user.sub;
  const isCarrier = bid.carrier_id === req.user.sub;
  if (!isShipper && !isCarrier) return res.status(403).json({ error: 'Nincs jogosultság' });
  if (!['pending', 'bidding'].includes(bid.job_status)) {
    return res.status(409).json({ error: 'A fuvar már nem alkudható.' });
  }
  if (bid.bid_status !== 'pending') {
    return res.status(409).json({ error: 'Erre a licitre már nem lehet ellenajánlatot tenni.' });
  }

  const role = isShipper ? 'shipper' : 'carrier';
  // A WHERE status='pending' atomikusan védi az időközbeni elfogadás ellen:
  // ha a licit közben accepted/rejected lett, az ellenajánlat nem íródik rá.
  const upd = await db.query(
    `UPDATE bids SET counter_amount_huf = $1, counter_by = $2, counter_at = NOW()
      WHERE id = $3 AND status = 'pending'`,
    [amt, role, bid.id],
  );
  if (upd.rowCount === 0) {
    return res.status(409).json({ error: 'Erre a licitre már nem lehet ellenajánlatot tenni.' });
  }

  const otherUserId = isShipper ? bid.carrier_id : bid.shipper_id;
  const link = isShipper ? `/sofor/fuvar/${bid.job_id}` : `/dashboard/fuvar/${bid.job_id}`;
  await createNotification({
    user_id: otherUserId,
    type: 'counter_offer',
    title: '🔁 Ellenajánlat érkezett',
    body: `Ellenajánlat a(z) "${bid.title || 'fuvar'}" fuvarra: ${amt.toLocaleString('hu-HU')} Ft.`,
    link,
  });
  realtime.emitToJob(bid.job_id, 'bid:countered', { bid_id: bid.id, counter_amount_huf: amt, counter_by: role });

  res.json({ ok: true, counter_amount_huf: amt, counter_by: role });
});

module.exports = router;
