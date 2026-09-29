import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import DijFizetesKartya from './DijFizetesKartya';
import { api } from '@/api';
import { kulsoOldalraLep } from '@/lib/navigacio';

// A díjfizetési kártya (CIB PR-3): a CIB-út átirányít a banki hop-linkre, a
// stub-út VÁLTOZATLANUL a /fizetes-stub-ra visz, a kupon és a régi
// gateway_url-ág megmarad. A CIB-es kötelező felületek csak CIB-módban
// látszanak — stubban a mai felület marad.
const m = vi.hoisted(() => ({
  push: vi.fn(),
  toast: { success: vi.fn(), error: vi.fn(), info: vi.fn() },
  socket: { on: vi.fn(), off: vi.fn() },
}));
vi.mock('next/navigation', () => ({ useRouter: () => ({ push: m.push, refresh: vi.fn() }) }));
vi.mock('@/components/ToastProvider', () => ({ useToast: () => m.toast }));
vi.mock('@/lib/socket', () => ({ getSocket: () => m.socket }));
vi.mock('@/lib/navigacio', async (orig) => ({ ...(await orig<typeof import('@/lib/navigacio')>()), kulsoOldalraLep: vi.fn() }));
vi.mock('@/api', async (orig) => {
  const valodi = await orig<typeof import('@/api')>();
  return { ...valodi, api: { payJob: vi.fn(), getFeePayment: vi.fn() } };
});

const CIB = { provider_kind: 'cib', can_pay: true, open_attempt: null, last_result: null };
const STUB = { provider_kind: 'stub', can_pay: true, open_attempt: null, last_result: null };

function kartya(props: Partial<React.ComponentProps<typeof DijFizetesKartya>> = {}) {
  return render(<DijFizetesKartya jobId="job-1" feeHuf={500} onFrissites={vi.fn()} {...props} />);
}

async function pipalEsFizet(gombNev: RegExp) {
  fireEvent.click(screen.getByRole('checkbox'));
  fireEvent.click(await screen.findByRole('button', { name: gombNev }));
}

beforeEach(() => {
  vi.clearAllMocks();
  window.history.replaceState({}, '', '/dashboard/fuvar/job-1');
  Element.prototype.scrollIntoView = vi.fn();
});
afterEach(() => { vi.useRealTimers(); });

describe('útválasztás: CIB átirányítás vs stub', () => {
  it('stub-mód: a mai felület és a /fizetes-stub', async () => {
    vi.mocked(api.getFeePayment).mockResolvedValue(STUB as any);
    vi.mocked(api.payJob).mockResolvedValue({ is_stub: true, gateway_url: 'stub:x', fee_huf: 500 } as any);
    kartya();
    await waitFor(() => expect(api.getFeePayment).toHaveBeenCalledWith('job-1'));
    expect(screen.queryByText('Kártyás fizetés szolgáltatója:')).toBeNull();
    await pipalEsFizet(/Díj fizetése \(500 Ft\)/);
    await waitFor(() => expect(m.push).toHaveBeenCalledWith('/fizetes-stub?job=job-1'));
    expect(kulsoOldalraLep).not.toHaveBeenCalled();
    expect(api.payJob).toHaveBeenCalledWith('job-1', true);
  });

  it('CIB-mód: a kötelező infó-blokk látszik, a fizetés a hop-linkre irányít', async () => {
    vi.mocked(api.getFeePayment).mockResolvedValue(CIB as any);
    vi.mocked(api.payJob).mockResolvedValue({
      provider: 'cib', trid: '1234567812345678', fee_huf: 500, is_stub: false, reused: false,
      redirect_url: 'https://api.gofuvar.hu/payments/cib/tovabb/tok', gateway_url: 'https://api.gofuvar.hu/payments/cib/tovabb/tok',
    } as any);
    kartya();
    expect(await screen.findByText('Kártyás fizetés szolgáltatója:')).toBeInTheDocument();
    expect(screen.getByText('Elfogadott kártyák')).toBeInTheDocument();
    expect(screen.getByText('A Kereskedő/Tiszta Hód Kft. székhelyének országa és országkódja: Magyarország (HU)')).toBeInTheDocument();
    expect(screen.getByText('A kártyaadataidat kizárólag a CIB Bank oldalán adod meg, a GoFuvar nem látja őket.')).toBeInTheDocument();
    expect(screen.getByText(/kb\. 10 perced van/)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Bankkártyás fizetés' })).toHaveAttribute('href', '/bankkartyas-fizetes');
    expect(screen.getByRole('link', { name: 'Adatkezelési tájékoztató' })).toHaveAttribute('href', '/adatkezeles');
    expect(screen.getByRole('link', { name: /CIB Bank/ })).toHaveAttribute('href', '/bankkartyas-fizetes');
    for (const alt of ['Visa', 'V Pay', 'Mastercard', 'Maestro']) expect(screen.getByAltText(alt)).toBeInTheDocument();

    await pipalEsFizet(/Fizetés bankkártyával \(500 Ft\)/);
    await waitFor(() => expect(kulsoOldalraLep).toHaveBeenCalledWith('https://api.gofuvar.hu/payments/cib/tovabb/tok'));
    expect(m.push).not.toHaveBeenCalled();
    // Az átirányítás alatt a gomb nem nyomható újra (dupla kattintás ellen).
    expect(screen.getByRole('button', { name: /Átirányítás a CIB Bankhoz/ })).toBeDisabled();
  });

  it('a fee-payment 404/403 → a stub-felület marad (nem törik az oldal)', async () => {
    vi.mocked(api.getFeePayment).mockRejectedValue(Object.assign(new Error('nincs'), { status: 404 }));
    kartya();
    await waitFor(() => expect(api.getFeePayment).toHaveBeenCalled());
    expect(await screen.findByRole('button', { name: /Díj fizetése \(500 Ft\)/ })).toBeInTheDocument();
    expect(screen.queryByText('Kártyás fizetés szolgáltatója:')).toBeNull();
  });

  it('kupon: nincs átirányítás, az oldal frissül', async () => {
    const onFrissites = vi.fn();
    vi.mocked(api.getFeePayment).mockResolvedValue(CIB as any);
    vi.mocked(api.payJob).mockResolvedValue({ paid_via_voucher: true, gateway_url: null, fee_huf: 0 } as any);
    kartya({ onFrissites });
    await screen.findByText('Kártyás fizetés szolgáltatója:');
    await pipalEsFizet(/Fizetés bankkártyával/);
    await waitFor(() => expect(onFrissites).toHaveBeenCalled());
    expect(m.toast.success).toHaveBeenCalled();
    expect(kulsoOldalraLep).not.toHaveBeenCalled();
  });

  it('régi válasz (csak gateway_url) → a gateway-re irányít', async () => {
    vi.mocked(api.getFeePayment).mockResolvedValue(STUB as any);
    vi.mocked(api.payJob).mockResolvedValue({ gateway_url: 'https://pay.example/x', fee_huf: 500 } as any);
    kartya();
    await pipalEsFizet(/Díj fizetése/);
    await waitFor(() => expect(kulsoOldalraLep).toHaveBeenCalledWith('https://pay.example/x'));
  });

  it('javascript: átirányítási cél → nem navigál, fix hibaszöveg', async () => {
    vi.mocked(api.getFeePayment).mockResolvedValue(CIB as any);
    vi.mocked(api.payJob).mockResolvedValue({ provider: 'cib', redirect_url: 'javascript:alert(1)', gateway_url: null } as any);
    kartya();
    await screen.findByText('Kártyás fizetés szolgáltatója:');
    await pipalEsFizet(/Fizetés bankkártyával/);
    await waitFor(() => expect(screen.getByRole('alert')).toBeInTheDocument());
    expect(kulsoOldalraLep).not.toHaveBeenCalled();
  });

  it('pipa nélkül nem indul fizetés', async () => {
    vi.mocked(api.getFeePayment).mockResolvedValue(CIB as any);
    kartya();
    const gomb = await screen.findByRole('button', { name: /Fizetés bankkártyával/ });
    expect(gomb).toBeDisabled();
    expect(api.payJob).not.toHaveBeenCalled();
  });
});

describe('hibakódok: fix magyar szöveg, nyers hiba soha', () => {
  it('503 CIB_UNAVAILABLE: saját szöveg, a szerver üzenete nem jelenik meg', async () => {
    vi.mocked(api.getFeePayment).mockResolvedValue(CIB as any);
    vi.mocked(api.payJob).mockRejectedValue(Object.assign(new Error('BELSŐ: ECONNREFUSED 10.0.0.7:443'), { code: 'CIB_UNAVAILABLE', status: 503 }));
    kartya();
    await screen.findByText('Kártyás fizetés szolgáltatója:');
    await pipalEsFizet(/Fizetés bankkártyával/);
    const doboz = await screen.findByRole('alert');
    expect(doboz.textContent).toMatch(/nem történt terhelés/);
    expect(document.body.textContent).not.toMatch(/ECONNREFUSED|10\.0\.0\.7/);
    expect(m.toast.error).toHaveBeenCalledWith(expect.any(String), expect.not.stringMatching(/ECONNREFUSED/));
    // Újrapróbálható: a gomb újra aktív.
    expect(screen.getByRole('button', { name: /Fizetés bankkártyával/ })).not.toBeDisabled();
  });

  it('409 CIB_PAYMENT_FINISHING: az állapotot újraolvassa (a lezárás-doboz jön)', async () => {
    vi.mocked(api.getFeePayment).mockResolvedValueOnce(CIB as any).mockResolvedValue({
      ...CIB, can_pay: false, open_attempt: { trid: '1', started_at: new Date().toISOString(), allapot: 'feldolgozas' },
    } as any);
    vi.mocked(api.payJob).mockRejectedValue(Object.assign(new Error('x'), { code: 'CIB_PAYMENT_FINISHING', status: 409 }));
    kartya();
    await screen.findByText('Kártyás fizetés szolgáltatója:');
    await pipalEsFizet(/Fizetés bankkártyával/);
    expect(await screen.findByText(/A fizetés lezárása folyamatban/)).toBeInTheDocument();
    expect(api.getFeePayment).toHaveBeenCalledTimes(2);
  });

  it('409 STATE_CHANGED: a fuvart frissíti', async () => {
    const onFrissites = vi.fn();
    vi.mocked(api.getFeePayment).mockResolvedValue(CIB as any);
    vi.mocked(api.payJob).mockRejectedValue(Object.assign(new Error('x'), { code: 'STATE_CHANGED', status: 409 }));
    kartya({ onFrissites });
    await screen.findByText('Kártyás fizetés szolgáltatója:');
    await pipalEsFizet(/Fizetés bankkártyával/);
    await waitFor(() => expect(onFrissites).toHaveBeenCalled());
  });

  it('indítás közben „Kapcsolódás a CIB Bankhoz…", 8 mp után a lassú-üzenet', async () => {
    vi.mocked(api.getFeePayment).mockResolvedValue(CIB as any);
    vi.mocked(api.payJob).mockImplementation(() => new Promise(() => {}));
    kartya();
    await screen.findByText('Kártyás fizetés szolgáltatója:');
    vi.useFakeTimers();
    fireEvent.click(screen.getByRole('checkbox'));
    fireEvent.click(screen.getByRole('button', { name: /Fizetés bankkártyával/ }));
    await act(async () => { await vi.advanceTimersByTimeAsync(0); });
    expect(screen.getByRole('button', { name: /Kapcsolódás a CIB Bankhoz/ })).toBeDisabled();
    expect(screen.queryByText(/A bank lassan válaszol/)).toBeNull();
    await act(async () => { await vi.advanceTimersByTimeAsync(8_100); });
    expect(screen.getByText(/A bank lassan válaszol, ne zárd be az oldalt/)).toBeInTheDocument();
  });
});

describe('állapotok a fee-payment válaszból', () => {
  it('vissza nem tért korábbi kísérlet: sárga sáv, a gomb marad', async () => {
    const perce3 = new Date(Date.now() - 3 * 60_000).toISOString();
    vi.mocked(api.getFeePayment).mockResolvedValue({
      ...CIB, open_attempt: { trid: '1', started_at: perce3, allapot: 'feldolgozas' },
    } as any);
    kartya();
    expect(await screen.findByText(/Egy korábbi fizetésed 3 perce indult, és nem fejeződött be/)).toBeInTheDocument();
    expect(screen.getByText(/kétszer biztosan nem terhelünk/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Fizetés bankkártyával/ })).toBeInTheDocument();
  });

  it('lezárás folyamatban: a fizetés-gomb rejtve', async () => {
    vi.mocked(api.getFeePayment).mockResolvedValue({
      ...CIB, can_pay: false, open_attempt: { trid: '1', started_at: new Date().toISOString(), allapot: 'feldolgozas' },
    } as any);
    kartya();
    expect(await screen.findByText(/A fizetés lezárása folyamatban/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Fizetés bankkártyával/ })).toBeNull();
    expect(screen.queryByRole('checkbox')).toBeNull();
  });

  it('ellenőrzés: „Ne fizess újra" TrID-del és elérhetőséggel, gomb nélkül', async () => {
    vi.mocked(api.getFeePayment).mockResolvedValue({
      ...CIB, can_pay: false, open_attempt: { trid: '9876543210123456', started_at: new Date().toISOString(), allapot: 'ellenorzes' },
    } as any);
    kartya();
    expect(await screen.findByText(/Ne fizess újra/)).toBeInTheDocument();
    expect(screen.getByText(/9876543210123456/)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /info@gofuvar\.hu/ })).toHaveAttribute('href', 'mailto:info@gofuvar.hu');
    expect(screen.queryByRole('button', { name: /Fizetés bankkártyával/ })).toBeNull();
  });

  it('előző kísérlet sikertelen: RC-csoport szerinti magyarázat + banki adatok + újrapróba', async () => {
    vi.mocked(api.getFeePayment).mockResolvedValue({
      ...CIB, last_result: {
        trid: '1111222233334444', rc: '54', rt: 'Lejárt kártya', amo: 500, cur: 'HUF', anum: null,
        rc_csoport: 'kartya', allapot: 'sikertelen',
      },
    } as any);
    kartya();
    expect(await screen.findByText(/Az előző fizetési kísérlet nem sikerült/)).toBeInTheDocument();
    expect(screen.getByText(/jól írtad-e be a kártyaszámot/)).toBeInTheDocument();
    // A kötelező adatsor lenyitható blokkban, a banki felirattal.
    expect(screen.getByText('A tranzakció azonosítója (TrID)')).toBeInTheDocument();
    expect(screen.getByText('1111222233334444')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Fizetés bankkártyával/ })).toBeInTheDocument();
  });

  it('az előző eredmény elrejthető (az eredményoldal már mutatja)', async () => {
    vi.mocked(api.getFeePayment).mockResolvedValue({
      ...CIB, last_result: { trid: '1', rc: '54', allapot: 'sikertelen' },
    } as any);
    kartya({ mutassElozoEredmenyt: false });
    await screen.findByRole('button', { name: /Fizetés bankkártyával/ });
    expect(screen.queryByText(/Az előző fizetési kísérlet nem sikerült/)).toBeNull();
  });
});

describe('URL-paraméterek', () => {
  it('?fizetes=ujra → a kártyára görget', async () => {
    window.history.replaceState({}, '', '/dashboard/fuvar/job-1?fizetes=ujra');
    vi.mocked(api.getFeePayment).mockResolvedValue(CIB as any);
    kartya();
    await waitFor(() => expect(Element.prototype.scrollIntoView).toHaveBeenCalled());
    // A paraméter eltűnik, hogy egy újratöltés ne görgessen / toastoljon újra.
    expect(window.location.search).not.toMatch(/fizetes=/);
  });

  it('?fizetes=link-lejart → toast: a link elhasználódott', async () => {
    window.history.replaceState({}, '', '/dashboard/fuvar/job-1?fizetes=link-lejart');
    vi.mocked(api.getFeePayment).mockResolvedValue(CIB as any);
    kartya();
    await waitFor(() => expect(m.toast.info).toHaveBeenCalledWith(
      expect.any(String), 'Ez a fizetési link már elhasználódott, indíts újat.',
    ));
  });
});
