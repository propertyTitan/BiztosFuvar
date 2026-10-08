// =====================================================================
//  LANDING-ADAT ŐR — UX-kör (2026-10-08)
//
//  A landingek egy adatfájlból generálódnak (landings.ts), ezért a hibáik is
//  osztályként jönnek: ha egy CTA szándék nélkül visz a regisztrációra, vagy
//  egy szöveg olyat állít, ami nem igaz, az MIND a 16 oldalon ott van.
//  Ez a fájl a javított szabályokat tartja (a javítás nélkül piros):
//   - Q2/Q3: a regisztrációs CTA viszi a szándékot (next / szerep / fiók),
//   - Q9: a Marketplace- és a nagygép-landing belépés nélkül indul (/hozasd-el),
//   - A4/A19: nincs „KYC" szakszó, „Ellenőrzött", „biztonságos átadás",
//     és nincs hamis rangsor-ígéret („előrébb hoznak"),
//   - A18: a díjmondat a közös, olvasható alak (nem „500 Ft 50 000 Ft"),
//   - A23: az érték-pontok rácsa a darabszámhoz igazodik (nincs árva kártya).
// =====================================================================
import { describe, it, expect } from 'vitest';
import {
  ALL_LANDINGS, FELADO_REGISZTRACIO_HREF, SZALLITO_REGISZTRACIO_HREF, HOZASD_EL_HREF,
  ertekPontElrendezes, getLandingBySlug,
} from './landings';
import { biztonsagosBelsoUt } from './navigacio';
import { DIJ_SAV_MONDAT } from './connectionFee';

const szoveg = (c: (typeof ALL_LANDINGS)[number]) => [
  c.metaTitle, c.metaDescription, c.eyebrow ?? '', c.headline, c.subhead,
  c.primaryCta.label,
  ...c.bullets.flatMap((b) => [b.title, b.desc]),
  ...(c.faq ?? []).flatMap((f) => [f.q, f.a]),
].join(' \n ');

describe('regisztrációs CTA-k: a szándék átmegy a regisztráción (Q2, Q3)', () => {
  it('egyetlen landing CTA sem visz a csupasz ?mode=register-re', () => {
    const csupasz = ALL_LANDINGS.filter((c) => c.primaryCta.href === '/bejelentkezes?mode=register');
    expect(
      csupasz.map((c) => c.slug),
      'Ezek a landingek szándék nélkül visznek a regisztrációra: a feladó a hubon köt ki, '
      + 'a szállító feladó módban.',
    ).toEqual([]);
  });

  it('a feladói CTA a regisztráció után az új fuvar űrlapjára visz, biztonságos belső úttal', () => {
    const url = new URL(FELADO_REGISZTRACIO_HREF, 'https://www.gofuvar.hu');
    expect(url.pathname).toBe('/bejelentkezes');
    expect(url.searchParams.get('mode')).toBe('register');
    expect(biztonsagosBelsoUt(url.searchParams.get('next'))).toBe('/dashboard/uj-fuvar');
    for (const slug of ['budapest-szeged', 'koltoztetes', 'autoszallitas']) {
      const c = ALL_LANDINGS.find((l) => l.slug === slug)!;
      expect(c.primaryCta.href, slug).toBe(FELADO_REGISZTRACIO_HREF);
    }
  });

  it('a szállítói landingek szállító módban, a fuvarlistára regisztrálnak', () => {
    const url = new URL(SZALLITO_REGISZTRACIO_HREF, 'https://www.gofuvar.hu');
    expect(url.searchParams.get('szerep')).toBe('szallito');
    expect(biztonsagosBelsoUt(url.searchParams.get('next'))).toBe('/sofor/fuvarok');
    expect(getLandingBySlug('soforoknek')!.primaryCta.href).toBe(SZALLITO_REGISZTRACIO_HREF);
    const fuvarozo = new URL(getLandingBySlug('fuvarozoknak')!.primaryCta.href, 'https://x.hu');
    expect(fuvarozo.searchParams.get('szerep')).toBe('szallito');
    expect(fuvarozo.searchParams.get('fiok')).toBe('ceg');
  });

  it('a webshop-landing céges FELADÓI fiókot nyit', () => {
    const webshop = new URL(getLandingBySlug('webshopoknak')!.primaryCta.href, 'https://x.hu');
    expect(webshop.searchParams.get('fiok')).toBe('ceg');
    expect(webshop.searchParams.get('szerep')).toBeNull();
    expect(biztonsagosBelsoUt(webshop.searchParams.get('next'))).toBe('/dashboard/uj-fuvar');
  });

  it('a Marketplace- és a nagygép-landing belépés nélkül, a Hozasd el úton indul (Q9)', () => {
    expect(getLandingBySlug('marketplace-elhozas')!.primaryCta.href).toBe(HOZASD_EL_HREF);
    expect(getLandingBySlug('nagygep-szallitas')!.primaryCta.href).toBe(HOZASD_EL_HREF);
  });
});

describe('a landing-szöveg csak azt állítja, ami igaz (A4, A5, A19)', () => {
  it('nincs „KYC" szakszó, „Ellenőrzött", „biztonságos átadás" és hamis rangsor-ígéret', () => {
    const talalatok: string[] = [];
    for (const c of ALL_LANDINGS) {
      const t = szoveg(c);
      for (const minta of [/\bKYC\b/, /ellenőrzött/i, /biztonságos\s+átadás/i, /előrébb\s+hoz/i]) {
        if (minta.test(t)) talalatok.push(`${c.slug}: ${minta}`);
      }
    }
    expect(talalatok).toEqual([]);
  });

  it('a díjmondat a közös, olvasható alak — nem „500 Ft 50 000 Ft fuvardíjig"', () => {
    for (const c of ALL_LANDINGS) {
      expect(szoveg(c), c.slug).not.toMatch(/500 Ft 50\s?000 Ft/);
    }
    const butor = szoveg(getLandingBySlug('butorszallitas')!);
    expect(butor).toContain(DIJ_SAV_MONDAT);
  });
});

describe('az érték-pontok rácsa a darabszámhoz igazodik (A23)', () => {
  it('4 pont → 2×2, 3 és 6 → 3 oszlop, 5 → középre igazított sorok', () => {
    expect(ertekPontElrendezes(4)).toEqual({ mod: 'racs', oszlopMinPx: 340 });
    expect(ertekPontElrendezes(2)).toEqual({ mod: 'racs', oszlopMinPx: 340 });
    expect(ertekPontElrendezes(3)).toEqual({ mod: 'racs', oszlopMinPx: 260 });
    expect(ertekPontElrendezes(6)).toEqual({ mod: 'racs', oszlopMinPx: 260 });
    expect(ertekPontElrendezes(5)).toEqual({ mod: 'kozepre' });
  });

  it('minden létező landing darabszáma kezelt (nincs árva kártya)', () => {
    for (const c of ALL_LANDINGS) {
      const e = ertekPontElrendezes(c.bullets.length);
      // 340 px-es minimumnál a 900 px-es sablon pontosan 2 oszlopot ad,
      // 260 px-esnél 3-at — a darabszám ezek többszöröse, vagy középre megy.
      if (e.mod === 'racs') {
        const oszlop = e.oszlopMinPx === 340 ? 2 : 3;
        expect(c.bullets.length % oszlop, c.slug).toBe(0);
      }
    }
  });
});
