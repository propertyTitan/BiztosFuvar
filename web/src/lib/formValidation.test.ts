// Űrlap-validáció (feladói űrlapok) — a 2026-08-04-i tesztelői kör
// észrevételeinek osztály-védelme: negatív / tört / hiányzó érték, és a
// címzett telefonszáma.
import { describe, it, expect } from 'vitest';
import {
  MAX_DIM_CM, MAX_HUF, MAX_WEIGHT_KG,
  intFieldError, moneyFieldError, weightFieldError,
  phoneError, emailError, parseNumericInput, sanitizeNumericInput,
} from './formValidation';

describe('beviteli szűrés — negatív be sem írható', () => {
  it('a mínuszjelet és a betűket eldobja', () => {
    expect(sanitizeNumericInput('-5')).toBe('5');
    expect(sanitizeNumericInput('-12.5')).toBe('12.5');
    expect(sanitizeNumericInput('12e3')).toBe('123');
    expect(sanitizeNumericInput('abc')).toBe('');
    expect(sanitizeNumericInput('')).toBe('');
  });

  it('a magyar tizedesvesszőt pontra cseréli, a köztes állapotot megtartja', () => {
    expect(sanitizeNumericInput('12,5')).toBe('12.5');
    // gépelés közbeni „12,” — különben eltűnne a mezőből
    expect(sanitizeNumericInput('12,')).toBe('12.');
    // több tizedespontból csak az első marad
    expect(sanitizeNumericInput('1.2.3')).toBe('1.23');
  });

  // FONTOS: az egész mezőkben (cm, Ft) a tizedest NEM dobjuk el némán —
  // ha eldobnánk, a 12,5 cm-ből 125 cm lenne, egy nagyságrenddel elhibázva.
  // Helyette átengedjük, és az intFieldError kiírja, hogy egész kell.
  it('egész mezőnél a tizedes bent marad, hogy hibaüzenetet kaphasson', () => {
    expect(sanitizeNumericInput('12,5')).toBe('12.5');
    expect(parseNumericInput('12.5')).toBe(12.5);
    expect(intFieldError(parseNumericInput('12,5'.replace(',', '.')), {
      label: 'Hosszúság (cm)', max: MAX_DIM_CM,
    })).toMatch(/egész számot/i);
  });

  it('parseNumericInput a köztes állapotokra üres értéket ad', () => {
    expect(parseNumericInput('')).toBe('');
    expect(parseNumericInput('.')).toBe('');
    expect(parseNumericInput('12.')).toBe(12);
    expect(parseNumericInput('0')).toBe(0);
  });
});

describe('intFieldError — csomagméret (cm)', () => {
  it('üres érték: „kérjük, töltsd ki"', () => {
    expect(intFieldError('', { label: 'Hosszúság (cm)', max: MAX_DIM_CM }))
      .toMatch(/Kérjük, töltsd ki/);
  });

  it('negatív értéket elutasít', () => {
    expect(intFieldError(-5, { label: 'Hosszúság (cm)', max: MAX_DIM_CM }))
      .toMatch(/negatív/i);
  });

  it('tört értéket elutasít', () => {
    expect(intFieldError(12.5, { label: 'Hosszúság (cm)', max: MAX_DIM_CM }))
      .toMatch(/egész számot/i);
  });

  it('a felső korlát fölött szól', () => {
    expect(intFieldError(MAX_DIM_CM + 1, { label: 'Hosszúság (cm)', max: MAX_DIM_CM }))
      .toMatch(/legfeljebb/);
  });

  it('érvényes egész értékre null', () => {
    expect(intFieldError(120, { label: 'Hosszúság (cm)', max: MAX_DIM_CM })).toBeNull();
    expect(intFieldError(MAX_DIM_CM, { label: 'Hosszúság (cm)', max: MAX_DIM_CM })).toBeNull();
  });
});

describe('weightFieldError — súly (kg)', () => {
  it('a tört súly MEGENGEDETT (12,5 kg valós eset)', () => {
    expect(weightFieldError(12.5)).toBeNull();
  });

  it('negatívat és nullát elutasít', () => {
    expect(weightFieldError(-1)).toMatch(/negatív/i);
    expect(weightFieldError(0)).toMatch(/nagyobb/i);
  });

  it('üresre „kérjük, töltsd ki"', () => {
    expect(weightFieldError('')).toMatch(/Kérjük, töltsd ki/);
  });

  it('irreálisan nagy súlyt elutasít', () => {
    expect(weightFieldError(MAX_WEIGHT_KG + 1)).toMatch(/legfeljebb/);
  });
});

describe('moneyFieldError — forint mezők', () => {
  it('kötelező mezőnél az üres érték hiba, opcionálisnál nem', () => {
    expect(moneyFieldError('', { label: 'Fuvardíj (Ft)' })).toMatch(/Kérjük, töltsd ki/);
    expect(moneyFieldError('', { label: 'Becsült érték (Ft)', required: false })).toBeNull();
  });

  it('negatív összeget elutasít', () => {
    expect(moneyFieldError(-100, { label: 'Fuvardíj (Ft)' })).toMatch(/negatív/i);
  });

  it('filléres (tört) összeget elutasít', () => {
    expect(moneyFieldError(1500.5, { label: 'Fuvardíj (Ft)' })).toMatch(/kerek forint/i);
  });

  it('a backend felső korlátjával egyezik', () => {
    expect(moneyFieldError(MAX_HUF, { label: 'Fuvardíj (Ft)' })).toBeNull();
    expect(moneyFieldError(MAX_HUF + 1, { label: 'Fuvardíj (Ft)' })).toMatch(/legfeljebb/);
  });
});

describe('phoneError — címzett telefonszáma', () => {
  it('üresre „kérjük, töltsd ki"', () => {
    expect(phoneError('')).toMatch(/Kérjük, töltsd ki/);
    expect(phoneError('   ')).toMatch(/Kérjük, töltsd ki/);
  });

  it('elfogadja a szokásos magyar és nemzetközi formákat', () => {
    expect(phoneError('+36 30 123 4567')).toBeNull();
    expect(phoneError('06301234567')).toBeNull();
    expect(phoneError('+43-664-1234567')).toBeNull();
    expect(phoneError('(06) 30/123-4567')).toBeNull();
  });

  it('elutasítja a betűt tartalmazót és a túl rövidet', () => {
    expect(phoneError('hívj fel')).toMatch(/csak számokat/i);
    expect(phoneError('123')).toMatch(/rövid/i);
    expect(phoneError('1234567890123456789')).toMatch(/hosszú/i);
  });
});

describe('emailError — opcionális címzett-email (GF-005, Manus 2026-08-30)', () => {
  it('üresen érvényes (a mező opcionális)', () => {
    expect(emailError('')).toBeNull();
    expect(emailError('   ')).toBeNull();
  });

  it('érvényes címeket elfogad', () => {
    expect(emailError('anna@email.hu')).toBeNull();
    expect(emailError('  nev.masodik+cimke@sub.domain.co.uk  ')).toBeNull();
  });

  it('a Manus-repró („hibas-email") és társai hibát kapnak', () => {
    // Követési linket ígérünk a címre — hibás címre a levél némán elveszne.
    expect(emailError('hibas-email')).toMatch(/érvénytelen/i);
    expect(emailError('nev@')).toMatch(/érvénytelen/i);
    expect(emailError('@domain.hu')).toMatch(/érvénytelen/i);
    expect(emailError('nev@domain')).toMatch(/érvénytelen/i);
    expect(emailError('nev@domain.h')).toMatch(/érvénytelen/i);
    expect(emailError('szó köz@domain.hu')).toMatch(/érvénytelen/i);
    expect(emailError(`${'a'.repeat(250)}@x.hu`)).toMatch(/érvénytelen/i);
  });
});
