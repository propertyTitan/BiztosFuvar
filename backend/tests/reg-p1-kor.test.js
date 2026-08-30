// =====================================================================
//  REGISZTRÁCIÓS P1-KÖR — Manus 3. futás (2026-08-30)
//
//  REG-P1-NEW-02: az e-mail-megerősítő link EGYSZER használatos volt, és
//  az újraküldés FELÜLÍRTA — az első kézi kattintás „érvénytelen"-t
//  kapott, ha (a) egy levelező-linkellenőrző már megnyitotta, VAGY (b) a
//  felhasználó közben új linket kért. A v2 token determinisztikus + HMAC
//  aláírt + IDEMPOTENS: akárhány megnyitás, akárhány újraküldés után is
//  ugyanaz a link él.
//
//  REG-P1-NEW-01 (user-döntés): személynévben nincs számjegy — a
//  kontakt-szűrő dátum-szerű neveknél zavaró „telefonszám"-hibát adott.
//
//  ⚠️ A regisztrációs végpont limitje 5/óra/IP, és a limiter a SIKERTELEN
//  kérést is számolja — ez a fájl pontosan 5 register-hívással gazdálkodik.
// =====================================================================
import { describe, it, expect } from 'vitest';
import request from 'supertest';

// A levelező elfogása a szerver betöltése ELŐTT (feketedoboz-minta):
// a route-ok destrukturálva importálnak, a foltnak előbb kell élnie.
const POSTALADA = [];
const emailService = require('../src/services/email');
emailService.sendEmailVerificationEmail = async (arg) => {
  POSTALADA.push(arg);
  return { stub: true };
};

const { app, db, createUser, uniqueEmail } = require('./helpers');

function utolsoLevelToken(cimzett) {
  const level = [...POSTALADA].reverse().find((l) => l.to === cimzett);
  if (!level) return null;
  return String(level.verifyUrl).split('token=')[1] || null;
}

async function regisztral(email, nev = 'Teszt Elek') {
  return request(app).post('/auth/register').send({
    email, password: 'TesztJelszo123', full_name: nev,
  });
}

describe('REG-P1-NEW-02: az e-mail-megerősítés idempotens és újraküldés-álló', () => {
  it('ugyanaz a link TÖBBSZÖR is megnyitható (linkellenőrző + kézi kattintás)', async () => {
    const email = uniqueEmail('verify1');
    const reg = await regisztral(email);                                   // register #1
    expect(reg.status).toBe(201);
    const token = utolsoLevelToken(email);
    expect(token, 'nem ment ki verifikációs levél').toBeTruthy();

    const elso = await request(app).get(`/auth/verify-email?token=${token}`);
    expect(elso.status).toBe(200);

    // A Manus-eset: a szkenner már „elfogyasztotta" — a kézi kattintásnak
    // ETTŐL MÉG sikert kell adnia.
    const masodik = await request(app).get(`/auth/verify-email?token=${token}`);
    expect(
      masodik.status,
      'A link a második megnyitásra „érvénytelen"-t adott — pontosan a '
      + 'linkellenőrzős hibamód (REG-P1-NEW-02): az első KÉZI kattintás bukna.',
    ).toBe(200);
  });

  it('újraküldés után az ELSŐ levél linkje is működik (nem írja felül)', async () => {
    const email = uniqueEmail('verify2');
    const reg = await regisztral(email);                                   // register #2
    expect(reg.status).toBe(201);
    const elsoToken = utolsoLevelToken(email);

    // A 60 mp-es újraküldési fék kikerülése: a küldési időt hátradátumozzuk.
    await db.query(
      `UPDATE users SET email_verification_sent_at = NOW() - INTERVAL '5 minutes' WHERE email = $1`,
      [email],
    );
    const resend = await request(app)
      .post('/auth/resend-verification')
      .set('Authorization', `Bearer ${reg.body.token}`);
    expect(resend.status).toBe(200);
    const masodikToken = utolsoLevelToken(email);

    expect(
      masodikToken,
      'az újraküldött levélnek UGYANAZT a linket kell vinnie — különben a '
      + 'korábbi levelek linkje meghal (a Manus-hiba fő gyanúsítottja)',
    ).toBe(elsoToken);

    const ver = await request(app).get(`/auth/verify-email?token=${elsoToken}`);
    expect(ver.status).toBe(200);
  });

  it('hamisított aláírású v2 token nem ér semmit', async () => {
    const user = await createUser({ emailVerified: false });
    const hamis = `v2.${user.id}.${'a'.repeat(64)}`;
    const res = await request(app).get(`/auth/verify-email?token=${hamis}`);
    expect(res.status).toBe(400);
    const { rows } = await db.query('SELECT email_verified FROM users WHERE id = $1', [user.id]);
    expect(rows[0].email_verified, 'a hamis token NEM állíthat át semmit').toBe(false);
  });

  it('a v2 ELŐTTI (legacy, hash-elt) linkek is idempotensek lettek', async () => {
    const crypto = require('crypto');
    const user = await createUser({ emailVerified: false });
    const legacyToken = 'legacy-teszt-token-123';
    const hash = crypto.createHash('sha256').update(legacyToken).digest('hex');
    await db.query(
      'UPDATE users SET email_verification_token_hash = $1 WHERE id = $2',
      [hash, user.id],
    );

    const elso = await request(app).get(`/auth/verify-email?token=${legacyToken}`);
    expect(elso.status).toBe(200);
    const masodik = await request(app).get(`/auth/verify-email?token=${legacyToken}`);
    expect(
      masodik.status,
      'a legacy link a második megnyitásra elhalt — a token nullázását a '
      + 'legacy ágból is ki kellett venni',
    ).toBe(200);
  });
});

describe('REG-P1-NEW-01: személynévben nincs számjegy (user-döntés)', () => {
  it('dátum-szerű név → értelmes hibát kap, NEM telefon-tiltást', async () => {
    const res = await regisztral(uniqueEmail('nev1'), 'QA Teszt 1988.02.12 2026.08.30'); // register #3
    expect(res.status).toBe(400);
    expect(res.body.code).toBe('NAME_HAS_DIGITS');
    expect(
      /telefonszám/i.test(res.body.error || ''),
      'A dátumos név megint a zavaró „telefonszám nem írható le" hibát kapta '
      + '— a Manus szerint ez konverziót veszít; a név-szabálynak kell szólnia.',
    ).toBe(false);
  });

  it('normál (kötőjeles, ékezetes) név átmegy', async () => {
    const res = await regisztral(uniqueEmail('nev2'), 'Kovács-Nagy Éva'); // register #4
    expect(res.status).toBe(201);
  });

  it('e-mail-cím a névben továbbra is tilos (a díj-védelem marad)', async () => {
    const res = await regisztral(uniqueEmail('nev3'), 'Iras kovacs@gmail.com'); // register #5
    expect(res.status).toBe(400);
    expect(res.body.code).toBe('CONTACT_LEAK');
  });

  it('a profil-módosítás is tartja a szabályt', async () => {
    const user = await createUser();
    const res = await request(app)
      .patch('/auth/me')
      .set('Authorization', `Bearer ${user.token}`)
      .send({ full_name: 'Teszt 0630123' });
    expect(res.status).toBe(400);
    expect(res.body.code).toBe('NAME_HAS_DIGITS');
  });
});
