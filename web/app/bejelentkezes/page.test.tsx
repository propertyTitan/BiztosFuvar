// =====================================================================
//  REGISZTRÁCIÓ — MEZŐSZINTŰ HIBÁK, ELÖL A LÉNYEG (UX-kör A10, 2026-10-08)
//
//  A régi űrlapon (1) az e-mail és a jelszó mobilon a második képernyőre
//  került, (2) üres beküldésre egyetlen „Hiányzó mezők" jött, rossz mező
//  alatt, és (3) MINDEN próba elment a szerverig — beleszámítva az óránként
//  5 regisztráció/IP limitbe. Plusz (Q3) a szállítói landingről érkező
//  szállító feladó módban kezdett. Ez a fájl mind a négyet méri.
// =====================================================================
import { act, fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import Bejelentkezes from './page';
import { readStoredMode } from '@/lib/auth';

const m = vi.hoisted(() => ({
  params: new URLSearchParams(),
  push: vi.fn(),
  register: vi.fn(),
  login: vi.fn(),
}));
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: m.push, replace: vi.fn() }),
  useSearchParams: () => m.params,
}));
vi.mock('@/api', () => ({
  api: {
    register: m.register,
    login: m.login,
    referralCheck: vi.fn().mockResolvedValue({ valid: true }),
  },
}));
vi.mock('@/lib/socket', () => ({ disconnectSocket: vi.fn(), refreshSocketAuth: vi.fn() }));
vi.mock('@/components/HozasdElContinuation', () => ({ HozasdElLoginHint: () => null }));

function nyit(query: string) {
  m.params = new URLSearchParams(query);
  return render(<Bejelentkezes />);
}

async function bekuld() {
  const gomb = screen.getByRole('button', { name: /Fiók létrehozása|Belépés →/ });
  await act(async () => { fireEvent.click(gomb); });
  await act(async () => { await new Promise((r) => requestAnimationFrame(() => r(null))); });
}

beforeEach(() => {
  localStorage.clear();
  m.push.mockReset();
  m.register.mockReset();
  m.login.mockReset();
});

describe('regisztráció: elöl a lényeg', () => {
  it('az e-mail-cím és a jelszó a név előtt áll', () => {
    const { container } = nyit('mode=register');
    const sorrend = [...container.querySelectorAll('input')].map((i) => i.id).filter(Boolean);
    expect(sorrend.indexOf('auth-email')).toBeLessThan(sorrend.indexOf('reg-name'));
    expect(sorrend.indexOf('auth-password')).toBeLessThan(sorrend.indexOf('reg-name'));
  });

  it('egységes „E-mail-cím" írásmód és helyes jogi link', () => {
    nyit('mode=register');
    expect(screen.getByLabelText('E-mail-cím')).toHaveAttribute('id', 'auth-email');
    expect(screen.getByRole('link', { name: 'Adatkezelési tájékoztatót' })).toHaveAttribute('href', '/adatkezeles');
  });
});

describe('regisztráció: a hiba a saját mezője alatt, hibás űrlap nem megy el', () => {
  it('üres beküldés: NINCS szerverhívás, minden kötelező mező jelez, a fókusz az elsőn', async () => {
    nyit('mode=register');
    await bekuld();
    expect(m.register, 'hibás űrlap a szerverig ment — a regisztrációs limit (5/óra/IP) fogy').not.toHaveBeenCalled();
    const email = screen.getByLabelText('E-mail-cím');
    expect(email).toHaveAttribute('aria-invalid', 'true');
    expect(email).toHaveAttribute('aria-describedby', 'auth-email-hiba');
    expect(document.getElementById('auth-email-hiba')).toHaveTextContent('Kérjük, add meg az e-mail-címed.');
    expect(screen.getByLabelText('Jelszó')).toHaveAttribute('aria-invalid', 'true');
    expect(screen.getByLabelText('Teljes név')).toHaveAttribute('aria-invalid', 'true');
    expect(document.activeElement).toBe(email);
  });

  it('a javított mezőről a hiba azonnal eltűnik, a többi marad', async () => {
    nyit('mode=register');
    await bekuld();
    fireEvent.change(screen.getByLabelText('E-mail-cím'), { target: { value: 'anna@pelda.hu' } });
    expect(screen.getByLabelText('E-mail-cím')).not.toHaveAttribute('aria-invalid');
    expect(screen.getByLabelText('Teljes név')).toHaveAttribute('aria-invalid', 'true');
  });

  it('számjegyes név és rövid jelszó: kliens-oldalon megfogva', async () => {
    nyit('mode=register');
    fireEvent.change(screen.getByLabelText('E-mail-cím'), { target: { value: 'anna@pelda.hu' } });
    fireEvent.change(screen.getByLabelText('Jelszó'), { target: { value: 'rovid' } });
    fireEvent.change(screen.getByLabelText('Teljes név'), { target: { value: 'Anna 1988' } });
    await bekuld();
    expect(m.register).not.toHaveBeenCalled();
    expect(document.getElementById('auth-password-hiba')).toHaveTextContent(/legalább 8 karakter/);
    expect(document.getElementById('reg-name-hiba')).toHaveTextContent('A név nem tartalmazhat számokat.');
  });

  it('a szerver 409-e (foglalt cím) az e-mail mező alatt jelenik meg', async () => {
    m.register.mockRejectedValueOnce(Object.assign(
      new Error('Ez az e-mail-cím már foglalt — ha a tiéd, lépj be, vagy kérj új jelszót.'),
      { code: 'EMAIL_TAKEN', status: 409 },
    ));
    nyit('mode=register');
    fireEvent.change(screen.getByLabelText('E-mail-cím'), { target: { value: 'anna@pelda.hu' } });
    fireEvent.change(screen.getByLabelText('Jelszó'), { target: { value: 'Jelszo123!' } });
    fireEvent.change(screen.getByLabelText('Teljes név'), { target: { value: 'Kiss Anna' } });
    await bekuld();
    expect(m.register).toHaveBeenCalledTimes(1);
    expect(document.getElementById('auth-email-hiba')).toHaveTextContent(/már foglalt/);
    expect(screen.getByLabelText('E-mail-cím')).toHaveAttribute('aria-invalid', 'true');
  });
});

describe('a szállítói landingről érkező regisztráló (Q3)', () => {
  it('a telefon látható, „szállítóként kötelező", és üresen nem enged tovább', async () => {
    nyit('mode=register&szerep=szallito&next=%2Fsofor%2Ffuvarok');
    expect(screen.getByText('(szállítóként kötelező)')).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText('E-mail-cím'), { target: { value: 'szallito@pelda.hu' } });
    fireEvent.change(screen.getByLabelText('Jelszó'), { target: { value: 'Jelszo123!' } });
    fireEvent.change(screen.getByLabelText('Teljes név'), { target: { value: 'Szabó Péter' } });
    await bekuld();
    expect(m.register).not.toHaveBeenCalled();
    expect(document.getElementById('reg-phone-hiba')).toHaveTextContent(/Szállítóként kötelező/);
  });

  it('sikeres regisztráció után szállító módban, a fuvarlistán kezd', async () => {
    m.register.mockResolvedValueOnce({
      token: 't', user: { id: 'uj-szallito', email: 'szallito@pelda.hu', role: 'shipper', full_name: 'Szabó Péter' },
    });
    nyit('mode=register&szerep=szallito&next=%2Fsofor%2Ffuvarok');
    fireEvent.change(screen.getByLabelText('E-mail-cím'), { target: { value: ' szallito@pelda.hu ' } });
    fireEvent.change(screen.getByLabelText('Jelszó'), { target: { value: 'Jelszo123!' } });
    fireEvent.change(screen.getByLabelText('Teljes név'), { target: { value: 'Szabó Péter' } });
    fireEvent.change(screen.getByLabelText(/Telefonszám/), { target: { value: '+36 30 123 4567' } });
    await bekuld();
    expect(m.register).toHaveBeenCalledWith(expect.objectContaining({
      email: 'szallito@pelda.hu', phone: '+36 30 123 4567', full_name: 'Szabó Péter',
    }));
    // A belépett (új) fiók tárolt módja — a helperen át (GF-006 forrás-őr).
    expect(readStoredMode()).toBe('driver');
    expect(m.push).toHaveBeenCalledWith('/sofor/fuvarok');
  });

  it('?fiok=ceg: a „Cégként" fül van kiválasztva', () => {
    nyit('mode=register&fiok=ceg');
    // UX A29: rádiócsoport — a „Fiók típusa" a csoport neve, a kiválasztott hallható.
    expect(screen.getByRole('radiogroup', { name: 'Fiók típusa' })).toBeInTheDocument();
    expect(screen.getByRole('radio', { name: 'Cégként' })).toHaveAttribute('aria-checked', 'true');
    expect(screen.getByRole('radio', { name: 'Magánszemélyként' })).toHaveAttribute('aria-checked', 'false');
    expect(screen.getByRole('tab', { name: 'Regisztráció' })).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByLabelText(/Cégnév/)).toBeInTheDocument();
  });
});

describe('ajánlói kód', () => {
  it('?ref linkkel a kinyitható rész nyitva, a kód kitöltve', () => {
    nyit('mode=register&ref=abc123');
    const ref = screen.getByLabelText('Ajánlói kód (opcionális)') as HTMLInputElement;
    expect(ref.value).toBe('ABC123');
    expect(ref.closest('details')).toHaveAttribute('open');
  });

  it('link nélkül összecsukva (a lényeg kerül előre)', () => {
    nyit('mode=register');
    const ref = screen.getByLabelText('Ajánlói kód (opcionális)');
    expect(ref.closest('details')).not.toHaveAttribute('open');
  });
});

describe('belépés', () => {
  it('üres belépés sem megy a szerverre, a hiba a mező alatt', async () => {
    nyit('');
    await bekuld();
    expect(m.login).not.toHaveBeenCalled();
    expect(document.getElementById('auth-password-hiba')).toHaveTextContent('Kérjük, add meg a jelszavad.');
  });
});
