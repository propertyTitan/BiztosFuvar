// A regisztrációs/belépési mezők kliens-szabályai (UX-kör A10, 2026-10-08) —
// a POST /auth/register szerver-szabályainak tükrei (backend/src/routes/
// auth.js: cleanFullName, NEV_SZAMJEGY_HIBA, validPassword, adószám-minta).
// Ha a kettő elcsúszik, a felhasználó vagy hamis kliens-hibát kap, vagy a
// hibás űrlap a szerverig megy — mindkettő a mezőszintű jelzés értelmét veszi.
import { describe, it, expect } from 'vitest';
import {
  requiredEmailError, newPasswordError, loginPasswordError, registrationNameError,
  requiredPhoneError, companyNameError, taxIdError,
} from './formValidation';

describe('e-mail-cím (kötelező)', () => {
  it('üres → kérés, rossz alak → példa, jó → null', () => {
    expect(requiredEmailError('')).toBe('Kérjük, add meg az e-mail-címed.');
    expect(requiredEmailError('   ')).toBe('Kérjük, add meg az e-mail-címed.');
    expect(requiredEmailError('anna@')).toMatch(/Érvénytelen e-mail-cím/);
    expect(requiredEmailError('anna@pelda.h')).toMatch(/Érvénytelen/);
    expect(requiredEmailError(' anna@pelda.hu ')).toBeNull();
  });
});

describe('jelszó', () => {
  it('regisztráció: legalább 8 ÉRDEMI karakter, legfeljebb 128 (a backend validPassword-je)', () => {
    expect(newPasswordError('')).toMatch(/adj meg/);
    expect(newPasswordError('rovid')).toMatch(/legalább 8/);
    expect(newPasswordError('        ')).toMatch(/legalább 8/);
    expect(newPasswordError('x'.repeat(129))).toMatch(/legfeljebb 128/);
    expect(newPasswordError('Jelszo123!')).toBeNull();
  });
  it('belépés: csak a kitöltöttség (a helyességet a szerver dönti el)', () => {
    expect(loginPasswordError('')).toMatch(/jelszavad/);
    expect(loginPasswordError('a')).toBeNull();
  });
});

describe('teljes név', () => {
  it('kötelező, 2–100 karakter, számjegy nélkül (REG-P1-NEW-01)', () => {
    expect(registrationNameError('')).toMatch(/add meg a teljes neved/);
    expect(registrationNameError('A')).toMatch(/legalább 2/);
    expect(registrationNameError('Kiss Anna 1988')).toBe('A név nem tartalmazhat számokat.');
    expect(registrationNameError('Kiss Anna')).toBeNull();
  });
});

describe('telefonszám — szállítóként kötelező', () => {
  it('üres → miért kell; formátum a profil szabálya szerint', () => {
    expect(requiredPhoneError('')).toMatch(/Szállítóként kötelező/);
    expect(requiredPhoneError('12')).toMatch(/6–15 számjegy/);
    expect(requiredPhoneError('+36 30 123 4567')).toBeNull();
  });
});

describe('céges regisztráció', () => {
  it('cégnév kötelező, legfeljebb 200 karakter', () => {
    expect(companyNameError('')).toMatch(/kötelező/);
    expect(companyNameError('x'.repeat(201))).toMatch(/200/);
    expect(companyNameError('Példa Kft.')).toBeNull();
  });
  it('adószám 12345678-1-42 alakban (a backend mintája)', () => {
    expect(taxIdError('')).toMatch(/kötelező/);
    expect(taxIdError('12345678')).toMatch(/Érvénytelen adószám/);
    expect(taxIdError(' 12345678-1-42 ')).toBeNull();
  });
});
