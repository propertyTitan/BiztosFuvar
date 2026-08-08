/* eslint-disable no-console */
// ÉLES füstteszt — admin ↔ user üzenetküldés (PR #112) a prod API-n
// (api.gofuvar.hu), jelölt tesztadatokkal, a végén teljes takarítással.
//
// Futtatás:  node scripts/admin-uzenet-eles-fustteszt.js
//
// Amit végigjátszik:
//   1. csatorna-szabály: admin-üzenet NÉLKÜL a user nem írhat (403 NO_CHANNEL)
//   2. admin közvetlen üzenet → in-app értesítés keletkezik
//   3. a user látja + can_reply, válaszol
//   4. az admin szál-listájában olvasatlan-badge, a szálban a válasz +
//      a user olvasás-visszajelzése (read_at)
//   5. GET /admin/users/:id részletnézet — DAC7-mező NINCS a válaszban
//
// ⚠️ KÖRÜZENETET SZÁNDÉKOSAN NEM tesztelünk élesben — az a prod összes
// valódi userének kimenne. Azt a backend-suite fedi (embedded PG-n).
//
// A script SOHA nem nyúl idegen (nem általa létrehozott) adathoz; az
// egyetlen kivétel a takarításban: a teszt-válasz által a VALÓDI
// admin(ok)nak generált értesítést a RUN_ID alapján törli.

const fs = require('fs');
const path = require('path');
const { Client } = require('pg');

const API = 'https://api.gofuvar.hu';
const RUN_ID = `dm-fust-${Date.now()}`;

const envRaw = fs.readFileSync(path.join(__dirname, '..', '.env'), 'utf8');
const DATABASE_URL = (envRaw.match(/^DATABASE_URL=(.+)$/m) || [])[1];
if (!DATABASE_URL) { console.error('Nincs DATABASE_URL a backend/.env-ben'); process.exit(1); }

const results = [];
function check(name, ok, detail = '') {
  results.push({ name, ok, detail });
  console.log(`${ok ? '✅' : '❌'} ${name}${detail ? ` — ${detail}` : ''}`);
}

async function api(method, pathName, { token, body } = {}) {
  const headers = {};
  if (token) headers.Authorization = `Bearer ${token}`;
  let payload;
  if (body !== undefined) {
    headers['Content-Type'] = 'application/json';
    payload = JSON.stringify(body);
  }
  const res = await fetch(`${API}${pathName}`, { method, headers, body: payload });
  let json = null;
  try { json = await res.json(); } catch { /* üres body */ }
  return { status: res.status, json };
}

async function main() {
  const db = new Client({ connectionString: DATABASE_URL });
  await db.connect();
  const created = { userIds: [] };

  try {
    // ===== 0. Két teszt-user a valós prod API-n =====
    const adminEmail = `${RUN_ID}-admin@teszt.gofuvar.hu`;
    const celEmail = `${RUN_ID}-cel@teszt.gofuvar.hu`;
    const reg1 = await api('POST', '/auth/register', {
      body: { email: adminEmail, password: 'FustTeszt123!', full_name: '[TESZT] DM Admin', phone: '+36 20 111 2233' },
    });
    const reg2 = await api('POST', '/auth/register', {
      body: { email: celEmail, password: 'FustTeszt123!', full_name: '[TESZT] DM Cél', phone: '+36 20 444 5566' },
    });
    check('Regisztráció (admin-jelölt + cél-user)', reg1.status === 201 && reg2.status === 201,
      `${reg1.status}/${reg2.status}`);
    const admin = { token: reg1.json?.token, id: reg1.json?.user?.id };
    const cel = { token: reg2.json?.token, id: reg2.json?.user?.id };
    created.userIds.push(admin.id, cel.id);

    // Admin-jog közvetlen DB-vel (az authRequired a DB-ből olvassa a szerepet,
    // így a már kiadott token is admin lesz — pont ezt javította a (c) fix)
    await db.query(`UPDATE users SET role = 'admin' WHERE id = $1 AND email = $2`, [admin.id, adminEmail]);

    // ===== 1. Csatorna-szabály: magától NEM írhat =====
    const tiltott = await api('POST', '/me/admin-messages', {
      token: cel.token, body: { body: 'Helló admin, írok magamtól!' },
    });
    check('User magától nem írhat (403 NO_CHANNEL)',
      tiltott.status === 403 && tiltott.json?.code === 'NO_CHANNEL', `${tiltott.status}/${tiltott.json?.code}`);

    // ===== 2. Admin közvetlen üzenet =====
    const uzenet = await api('POST', `/admin/dm/with/${cel.id}`, {
      token: admin.token,
      body: { body: `Ez egy éles teszt-üzenet a GoFuvar csapatától (${RUN_ID}). Ha látod, működik! 🎉`, send_email: false },
    });
    check('Admin közvetlen üzenet (201, kind=direct)',
      uzenet.status === 201 && uzenet.json?.kind === 'direct', `${uzenet.status}/${uzenet.json?.kind}`);

    const { rows: notif } = await db.query(
      `SELECT link FROM notifications WHERE user_id = $1 AND type = 'admin_message'`, [cel.id],
    );
    check('In-app értesítés keletkezett (link: /uzenetek)',
      notif.length === 1 && notif[0].link === '/uzenetek', JSON.stringify(notif[0] || null));

    // ===== 3. A user látja és válaszol =====
    const szal = await api('GET', '/me/admin-messages', { token: cel.token });
    check('A user látja az üzenetet + can_reply',
      szal.status === 200 && szal.json?.messages?.length === 1 && szal.json?.can_reply === true,
      `${szal.status}, ${szal.json?.messages?.length} üzenet, can_reply=${szal.json?.can_reply}`);

    const valasz = await api('POST', '/me/admin-messages', {
      token: cel.token, body: { body: `Válasz a teszt-üzenetre (${RUN_ID}) — köszönöm!` },
    });
    check('A user válasza megy (201, kind=user_reply)',
      valasz.status === 201 && valasz.json?.kind === 'user_reply', `${valasz.status}/${valasz.json?.kind}`);

    // ===== 4. Admin-oldal: badge + szál + olvasás-visszajelzés =====
    const threads = await api('GET', '/admin/dm/threads', { token: admin.token });
    const sor = (threads.json || []).find((t) => t.user_id === cel.id);
    check('Szál-lista: olvasatlan válasz badge (unread=1)',
      threads.status === 200 && sor?.unread_count === 1 && sor?.last_sender === 'user',
      `unread=${sor?.unread_count}, last_sender=${sor?.last_sender}`);

    const adminSzal = await api('GET', `/admin/dm/with/${cel.id}`, { token: admin.token });
    const direktUzenet = (adminSzal.json?.messages || []).find((m) => m.kind === 'direct');
    check('Admin-szál: 2 üzenet + a user olvasás-visszajelzése (read_at)',
      adminSzal.status === 200 && adminSzal.json?.messages?.length === 2 && !!direktUzenet?.read_at,
      `${adminSzal.json?.messages?.length} üzenet, read_at=${direktUzenet?.read_at ? 'megvan' : 'HIÁNYZIK'}`);

    const threads2 = await api('GET', '/admin/dm/threads', { token: admin.token });
    const sor2 = (threads2.json || []).find((t) => t.user_id === cel.id);
    check('A szál megnyitása nullázta a badge-et', sor2?.unread_count === 0, `unread=${sor2?.unread_count}`);

    // ===== 5. Teljes user-részletnézet — DAC7 kizárva =====
    const reszlet = await api('GET', `/admin/users/${cel.id}`, { token: admin.token });
    check('Részletnézet: email_verified + has_tax_data megvan, DAC7-adat NINCS',
      reszlet.status === 200
        && 'email_verified' in (reszlet.json || {})
        && 'has_tax_data' in (reszlet.json || {})
        && !('personal_tax_id' in (reszlet.json || {}))
        && !('birth_date' in (reszlet.json || {}))
        && !('password_hash' in (reszlet.json || {})),
      `status=${reszlet.status}`);

    // ===== 6. Harang-badge fix (PR #114): a szál-megnyitás az értesítést is olvasta =====
    const { rows: notifKesobb } = await db.query(
      `SELECT read_at FROM notifications WHERE user_id = $1 AND type = 'admin_message'`, [cel.id],
    );
    check('Badge-fix: a /uzenetek megnyitása a notification-sort is olvasottra állította',
      notifKesobb.length === 1 && notifKesobb[0].read_at !== null,
      notifKesobb[0]?.read_at ? 'read_at megvan' : 'read_at HIÁNYZIK');

    // ===== 7. Csatorna-lezárás (PR #114): zárva 403, visszanyitva megy =====
    const zaras = await api('PATCH', '/admin/dm/channel', {
      token: admin.token, body: { user_id: cel.id, closed: true },
    });
    const zartValasz = await api('POST', '/me/admin-messages', {
      token: cel.token, body: { body: 'Zárt csatornán próbálkozom.' },
    });
    check('Csatorna lezárva: a user válasza 403 CHANNEL_CLOSED',
      zaras.status === 200 && zartValasz.status === 403 && zartValasz.json?.code === 'CHANNEL_CLOSED',
      `${zaras.status}/${zartValasz.status}/${zartValasz.json?.code}`);

    const nyitas = await api('PATCH', '/admin/dm/channel', {
      token: admin.token, body: { user_id: cel.id, closed: false },
    });
    const ujraValasz = await api('POST', '/me/admin-messages', {
      token: cel.token, body: { body: `Visszanyitva megy (${RUN_ID}).` },
    });
    check('Csatorna visszanyitva: a válasz újra megy',
      nyitas.status === 200 && ujraValasz.status === 201, `${nyitas.status}/${ujraValasz.status}`);
  } finally {
    // ===== TAKARÍTÁS — csak a script által létrehozott sorok =====
    console.log('\n--- Takarítás a prod DB-ben ---');
    const ids = created.userIds.filter(Boolean);
    if (ids.length) {
      // A teszt-válasz a VALÓDI admin(ok)nak is generált értesítést — RUN_ID alapján töröljük
      await db.query(`DELETE FROM notifications WHERE type = 'admin_dm_reply' AND body LIKE $1`, [`%${RUN_ID}%`]).catch(() => {});
      const del = await db.query(
        `DELETE FROM users WHERE id = ANY($1::uuid[]) AND email LIKE '%@teszt.gofuvar.hu' RETURNING email`, [ids],
      );
      console.log(`Törölve: ${del.rows.map((r) => r.email).join(', ')} (+ cascade: admin_messages, notifications)`);
      const { rows: maradek } = await db.query(
        `SELECT COUNT(*)::int AS c FROM admin_messages WHERE user_id = ANY($1::uuid[])`, [ids],
      );
      console.log(`Maradék teszt-üzenet a DB-ben: ${maradek[0].c} (0 az elvárt)`);
    }
    await db.end();
  }

  const failed = results.filter((r) => !r.ok);
  console.log(`\n===== EREDMÉNY: ${results.length - failed.length}/${results.length} PASS =====`);
  if (failed.length) process.exit(1);
}

main().catch((e) => { console.error('FATÁLIS:', e); process.exit(1); });
