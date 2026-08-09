// =====================================================================
//  KYC: mikor NEM elég az AI ítélete (audit 3. kör, 2026-08-09)
//
//  A KYC-döntés „vak" auto-approve volt: `valid: true` (0.6 bizalom felett)
//  → a fiók AZONNAL 'verified'. Ezen áll a szállítói jogosultság és az
//  „egy okmány = egy fiók" csalásvédelem is. Az automatizmus megmarad, de a
//  kockázatos jeleket emberhez tereljük: alacsony bizalom, név-eltérés,
//  másolat/képernyőfotó gyanú, olvashatatlan okmányszám.
// =====================================================================
import { describe, it, expect } from 'vitest';

const {
  needsManualReview, holderNameMatches, AUTO_APPROVE_MIN_CONFIDENCE,
} = require('../src/services/kycReview');

/** Alapból „tiszta" AI-eredmény, amit a tesztek elrontanak. */
const rendben = (extra = {}) => ({
  valid: true,
  confidence: 0.95,
  documentNumber: 'AB123456',
  holderName: 'Kovács Anna',
  likelyCopy: false,
  ...extra,
});

describe('Név-egyeztetés az okmány és a fiók között', () => {
  it('sorrend-független és ékezet-tűrő', () => {
    expect(holderNameMatches('Kovács Anna', 'Anna Kovacs')).toBe(true);
    expect(holderNameMatches('KOVÁCS ANNA', 'Kovács Anna')).toBe(true);
    expect(holderNameMatches('Dr. Kovács Anna', 'Kovács Anna')).toBe(true);
  });

  it('más ember neve nem egyezik', () => {
    expect(holderNameMatches('Nagy Béla', 'Kovács Anna')).toBe(false);
    expect(holderNameMatches('Kovács Bence', 'Kovács Anna')).toBe(false);
  });

  it('hiányzó név nem egyezés (nem is engedhető át némán)', () => {
    expect(holderNameMatches(null, 'Kovács Anna')).toBe(false);
    expect(holderNameMatches('Kovács Anna', '')).toBe(false);
  });
});

describe('needsManualReview — mi megy emberhez', () => {
  it('tiszta eset: marad az automatikus jóváhagyás', () => {
    expect(needsManualReview(rendben(), { fullName: 'Kovács Anna' }, 'id_card')).toBeNull();
  });

  it('alacsony bizalom → kézi ellenőrzés', () => {
    const alacsony = rendben({ confidence: AUTO_APPROVE_MIN_CONFIDENCE - 0.01 });
    expect(needsManualReview(alacsony, { fullName: 'Kovács Anna' }, 'id_card').code).toBe('LOW_CONFIDENCE');
    // pont a küszöbön még átmegy
    const hataron = rendben({ confidence: AUTO_APPROVE_MIN_CONFIDENCE });
    expect(needsManualReview(hataron, { fullName: 'Kovács Anna' }, 'id_card')).toBeNull();
  });

  it('másolat/képernyőfotó gyanú → kézi ellenőrzés (ez a legerősebb jel)', () => {
    const masolat = rendben({ likelyCopy: true });
    expect(needsManualReview(masolat, { fullName: 'Kovács Anna' }, 'id_card').code).toBe('LIKELY_COPY');
  });

  it('név-eltérés → kézi ellenőrzés (más ember okmánya)', () => {
    const r = needsManualReview(rendben(), { fullName: 'Nagy Béla' }, 'id_card');
    expect(r.code).toBe('NAME_MISMATCH');
  });

  it('olvashatatlan okmányszám → kézi ellenőrzés (a duplikátum-védelem nem futna)', () => {
    const nincsSzam = rendben({ documentNumber: null });
    expect(needsManualReview(nincsSzam, { fullName: 'Kovács Anna' }, 'id_card').code).toBe('NO_DOC_NUMBER');
  });

  it('céges iratnál nincs név- és okmányszám-követelmény', () => {
    const ceges = rendben({ documentNumber: null, holderName: null });
    expect(needsManualReview(ceges, { fullName: 'Kovács Anna' }, 'company_document')).toBeNull();
  });

  it('a felhasználónak szóló indoklás magyar és nem vádol', () => {
    const r = needsManualReview(rendben({ likelyCopy: true }), { fullName: 'Kovács Anna' }, 'id_card');
    expect(r.reason).toMatch(/ellenőrzi|ellenőriz/i);
    expect(r.reason).not.toMatch(/csal|hamis/i);
  });
});
