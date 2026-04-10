// Expo Push Notification küldés.
//
// Az Expo Push API-n keresztül küldjük a push-okat az Expo Go / standalone
// build-eknek. A token regisztrációt a POST /push-tokens végpont végzi,
// a küldést a `sendPushToUser(userId, { title, body, data })` helper.
//
// Ha nincs Expo push token a userhez → csendben kihagyjuk (nem hiba).
const db = require('../db');

const EXPO_PUSH_URL = 'https://exp.host/--/api/v2/push/send';

/**
 * Push notification küldés egy adott user ÖSSZES regisztrált eszközére.
 * Fire-and-forget: soha nem dob hibát, log-ol ha baj van.
 */
async function sendPushToUser(userId, { title, body, data }) {
  try {
    const { rows } = await db.query(
      'SELECT token FROM push_tokens WHERE user_id = $1',
      [userId],
    );
    if (rows.length === 0) return; // nincs regisztrált eszköz

    const messages = rows.map((r) => ({
      to: r.token,
      sound: 'default',
      title,
      body,
      data: data || {},
    }));

    const res = await fetch(EXPO_PUSH_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(messages),
    });
    if (!res.ok) {
      console.warn('[push] Expo API hiba:', res.status, await res.text().catch(() => ''));
    }
  } catch (err) {
    console.warn('[push] hiba:', err.message);
  }
}

module.exports = { sendPushToUser };
