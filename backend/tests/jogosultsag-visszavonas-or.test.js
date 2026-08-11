// =====================================================================
//  JOGOSULTSÁG-VISSZAVONÁS ŐR (2026-08-11)
//
//  ⚠️ A MINTA NEGYEDSZER IS MEGISMÉTLŐDÖTT: „a védelem azon az úton épül meg,
//  ahol felfedezték". A session-invalidáció KÉT úton történik:
//
//    * admin force-logout (admin.js) → token_version++ ÉS disconnectUser  ✅
//    * jelszó-reset (auth.js)        → token_version++, socket-bontás NÉLKÜL ❌
//
//  A `token_version` léptetése CSAK a REST-oldalt zárja: a socket
//  token-ellenőrzése kizárólag a HANDSHAKE-kor fut (realtime.js), egy már
//  felépült kapcsolat sosem esik át rajta újra. A jelszó-reset viszont épp a
//  kompromittált fiók visszaszerzésének fő felhasználói eszköze — a támadó
//  nyitva hagyott füle tovább kapta volna az értesítéseket (chat-részlet,
//  fizetési gateway-URL), az élő GPS-t és a `feed`-en az új fuvarok PONTOS
//  címét.
//
//  ⚠️ MIÉRT NEM SZÖVEG-ILLESZTÉS (ez a lényeg): a korábbi socket-őrünk
//  (`level-html-es-socket.test.js`) azt nézte, hogy egy forrás-szeletben
//  szerepel-e az `evictUserFromJob` szó — azt egy KOMMENT is kielégíti, és
//  csak EGY példányra kérdezett rá. Ez az őr ezért kettéválik:
//
//    FELFEDEZÉS (forrásból): hol léptetjük a token_version-t? — ez csak
//      annyit ér el, hogy egy ÚJ út ne maradhasson észrevétlen.
//    KIKÉNYSZERÍTÉS (futtatva): a valódi HTTP-végpontot meghívjuk, és
//      megmérjük, tényleg meghívódott-e a bontás. Egy komment ezt nem
//      elégíti ki; ha valaki kiveszi a sort, ez a teszt pirosra vált.
// =====================================================================
import {
  describe, it, expect, beforeAll, afterAll,
} from 'vitest';
import crypto from 'crypto';
import { readFileSync, readdirSync } from 'fs';
import request from 'supertest';

const { app, db, createUser } = require('./helpers');
const realtime = require('../src/realtime');

// A session-invalidáló utak nyilvántartása. Kulcs: a forrásban megtalált
// léptetési hely; érték: 'bont' (a viselkedés-teszt fedi) vagy indoklás.
const VISSZAVONO_UTAK = {
  'routes/auth.js': 'bont', // POST /auth/reset-password
  'routes/admin.js': 'bont', // POST /admin/users/:id/force-logout
};

let eredetiBont;
const hivasok = [];

beforeAll(() => {
  // A route-ok `require('../realtime').disconnectUser(...)`-t hívnak a kérés
  // pillanatában, tehát a tulajdonságot futásidőben oldják fel — így a
  // require-cache-beli objektumon cserélve valóban a valódi hívást mérjük.
  eredetiBont = realtime.disconnectUser;
  realtime.disconnectUser = async (id) => { hivasok.push(String(id)); };
});

afterAll(() => { realtime.disconnectUser = eredetiBont; });

describe('Jogosultság-visszavonás — az élő csatorna is bomlik', () => {
  it('a jelszó-reset BONTJA a nyitott socketet (nem csak a REST-et zárja)', async () => {
    const user = await createUser({ role: 'shipper' });

    // Valódi reset-token elhelyezése (a végpont sha256-lenyomat szerint keres).
    const token = crypto.randomBytes(32).toString('hex');
    const hash = crypto.createHash('sha256').update(token).digest('hex');
    await db.query(
      `UPDATE users SET password_reset_token_hash = $1,
                        password_reset_expires_at = NOW() + INTERVAL '30 minutes'
        WHERE id = $2`,
      [hash, user.id],
    );

    hivasok.length = 0;
    const res = await request(app)
      .post('/auth/reset-password')
      .send({ token, password: 'ujJelszo12345' });

    expect(res.status, 'a jelszó-reset nem sikerült — a teszt nem mér semmit').toBe(200);
    expect(
      hivasok,
      'A jelszó-reset NEM bontotta a nyitott socketet.\n\n'
      + 'A token_version léptetése csak a REST-oldalt zárja: a socket\n'
      + 'token-ellenőrzése kizárólag a handshake-kor fut, egy már felépült\n'
      + 'kapcsolat sosem esik át rajta újra. Az ellopott tokennel nyitott fül\n'
      + 'tovább kapná az értesítéseket, az élő GPS-t és a feed pontos címeit.\n\n'
      + 'Tedd vissza: require("../realtime").disconnectUser(user.id)',
    ).toContain(String(user.id));
  });

  it('az admin force-logout is BONTJA a socketet', async () => {
    const admin = await createUser({ role: 'admin' });
    const aldozat = await createUser({ role: 'shipper' });

    hivasok.length = 0;
    const res = await request(app)
      .post(`/admin/users/${aldozat.id}/force-logout`)
      .set('Authorization', `Bearer ${admin.token}`);

    expect(res.status).toBe(200);
    expect(
      hivasok,
      'Az admin force-logout nem bontotta az élő kapcsolatot.',
    ).toContain(String(aldozat.id));
  });

  it('minden session-invalidáló út be van sorolva (új út nem maradhat észrevétlen)', () => {
    const dir = `${__dirname}/../src`;
    const talalt = new Set();

    const bejar = (mappa, elotag = '') => {
      for (const bejegyzes of readdirSync(mappa, { withFileTypes: true })) {
        const utvonal = `${mappa}/${bejegyzes.name}`;
        const rel = elotag ? `${elotag}/${bejegyzes.name}` : bejegyzes.name;
        if (bejegyzes.isDirectory()) { bejar(utvonal, rel); continue; }
        if (!bejegyzes.name.endsWith('.js')) continue;
        const forras = readFileSync(utvonal, 'utf8');
        // Kommentek nélkül nézzük — különben egy magyarázó mondat is „találat".
        const kodOnly = forras.replace(/\/\/[^\n]*/g, '').replace(/\/\*[\s\S]*?\*\//g, '');
        if (/token_version\s*(?:=\s*(?:COALESCE\()?\s*token_version[^,\n]*\+\s*1|\+\s*1)/.test(kodOnly)) {
          talalt.add(rel);
        }
      }
    };
    bejar(dir);

    expect(talalt.size, 'nem találtam egyetlen token_version-léptetést sem — az őr vak').toBeGreaterThan(0);

    const besorolatlan = [...talalt].filter((f) => !VISSZAVONO_UTAK[f]);
    expect(
      besorolatlan,
      `Ezek a fájlok érvénytelenítik a sessiont, de nincsenek besorolva:\n  ${besorolatlan.join('\n  ')}\n\n`
      + 'Aki a REST-sessiont érvényteleníti, annak az ÉLŐ CSATORNÁT is le kell\n'
      + 'zárnia (disconnectUser) — különben a visszavonás csak félig történik meg.\n'
      + 'Vedd fel a VISSZAVONO_UTAK-ba, és írj rá viselkedés-tesztet ide.',
    ).toEqual([]);
  });

  it('a nyilvántartás nem avulhat el', () => {
    const dir = `${__dirname}/../src`;
    const letezik = (f) => {
      try { readFileSync(`${dir}/${f}`, 'utf8'); return true; } catch { return false; }
    };
    const holt = Object.keys(VISSZAVONO_UTAK).filter((f) => !letezik(f));
    expect(holt, `Nem létező fájl a nyilvántartásban: ${holt.join(', ')}`).toEqual([]);
  });
});
