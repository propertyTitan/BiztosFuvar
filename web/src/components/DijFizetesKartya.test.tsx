import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import DijFizetesKartya from './DijFizetesKartya';
import { api } from '@/api';
import { kulsoOldalraLep } from '@/lib/navigacio';
import { CIB_ADATKEZELESI_LINK, CIB_ADATKEZELESI_NYILATKOZAT } from '@/lib/cibFeliratok';

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

/** Minden nyilatkozat kipipálása (CIB-módban kettő van, stubban egy). */
function mindentPipal() {
  for (const doboz of screen.getAllByRole('checkbox')) fireEvent.click(doboz);
}

async function pipalEsFizet(gombNev: RegExp) {
  mindentPipal();
  fireEvent.click(await screen.findByRole('button', { name: gombNev }));
}

beforeEach(() => {
  vi.clearAllMocks();
  window.history.replaceState({}, '', '/dashboard/fuvar/job-1');
  Element.prototype.scrollIntoView = vi.fn();
});
afterEach(() => { vi.useRealTimers(); });

describe('a díj ezres tagolással (UX A17)', () => {
  it('a 1 000 Ft-os díj gombja „1 000 Ft”, nem „1000 Ft” — mint a kártya fejléce', async () => {
    vi.mocked(api.getFeePayment).mockResolvedValue(STUB as any);
    kartya({ feeHuf: 1000 });
    expect(await screen.findByRole('button', { name: /Díj fizetése \(1 000 Ft\)/ })).toBeInTheDocument();
  });
});

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
    // 2026-10-01 (a PR-4 1. javítóköre): a helyi lezárási ablak a MSGT10-től
    // 9 perc 30 mp, és a zárás is ebbe esik — „kb. 10 perc", majd „kb. 9
    // perc" is túlígéret volt (2026-10-03, CIB PR-5).
    expect(screen.getByText(/kb\. 8 percen belül/)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Bankkártyás fizetés' })).toHaveAttribute('href', '/bankkartyas-fizetes');
    // 2026-10-01 (a PR-4 1. javítóköre, WCAG 2.4.4): a kártyán két azonos
    // nevű „Adatkezelési tájékoztató" link van (az infó-blokké és a
    // nyilatkozaté) — azonos névvel azonos célra kell mutatniuk: a
    // tájékoztató CIB-szakaszára.
    expect(within(screen.getByTestId('cib-fizetes-info')).getByRole('link', { name: 'Adatkezelési tájékoztató' }))
      .toHaveAttribute('href', '/adatkezeles#cib-kartyas-fizetes');
    const celok = new Set(screen.getAllByRole('link', { name: 'Adatkezelési tájékoztató' }).map((a) => a.getAttribute('href')));
    expect([...celok], 'azonos nevű linkek eltérő célra mutatnak').toEqual(['/adatkezeles#cib-kartyas-fizetes']);
    expect(screen.getByRole('link', { name: /CIB Bank/ })).toHaveAttribute('href', '/bankkartyas-fizetes');
    for (const alt of ['Visa', 'V Pay', 'Mastercard', 'Maestro']) expect(screen.getByAltText(alt)).toBeInTheDocument();

    await pipalEsFizet(/Fizetés bankkártyával \(500 Ft\)/);
    await waitFor(() => expect(kulsoOldalraLep).toHaveBeenCalledWith('https://api.gofuvar.hu/payments/cib/tovabb/tok'));
    expect(m.push).not.toHaveBeenCalled();
    // CIB-úton a payJob az adattovábbítási nyilatkozatot is viszi.
    expect(api.payJob).toHaveBeenCalledWith('job-1', true, true);
    // Az átirányítás alatt a gomb nem nyomható újra (dupla kattintás ellen).
    // findByRole: a felirat a navigáció UTÁNI renderben frissül (React
    // kötegel) — a lassabb CI-gépen a szinkron getByRole túl korán nézte.
    expect(await screen.findByRole('button', { name: /Átirányítás a CIB Bankhoz/ })).toBeDisabled();
  });

  it.each([
    ['hiányzó gateway_url', null],
    ['eltérő (régi) gateway_url', 'https://regi.example/gateway'],
  ])('CIB: a redirect_url az elsődleges cél (%s)', async (_nev, gatewayUrl) => {
    // Ha a CIB-ág kiesne, a régi gateway_url-ág vinné tovább a felhasználót —
    // ezért a két cél itt SZÁNDÉKOSAN eltér (vagy a régi hiányzik).
    vi.mocked(api.getFeePayment).mockResolvedValue(CIB as any);
    vi.mocked(api.payJob).mockResolvedValue({
      provider: 'cib', trid: '1234567812345678', fee_huf: 500, is_stub: false, reused: false,
      redirect_url: 'https://api.gofuvar.hu/payments/cib/tovabb/uj', gateway_url: gatewayUrl,
    } as any);
    kartya();
    await screen.findByText('Kártyás fizetés szolgáltatója:');
    await pipalEsFizet(/Fizetés bankkártyával/);
    await waitFor(() => expect(kulsoOldalraLep).toHaveBeenCalledWith('https://api.gofuvar.hu/payments/cib/tovabb/uj'));
    expect(kulsoOldalraLep).toHaveBeenCalledTimes(1);
  });

  it('amíg a fizetési mód nem ismert, a gomb nem nyomható és nem ígér (stub-)fizetési módot', async () => {
    vi.mocked(api.getFeePayment).mockImplementation(() => new Promise(() => {}));
    kartya();
    fireEvent.click(screen.getByRole('checkbox'));
    const gomb = screen.getByRole('button', { name: /Betöltés/ });
    expect(gomb).toBeDisabled();
    expect(screen.queryByRole('button', { name: /Díj fizetése/ })).toBeNull();
    fireEvent.click(gomb);
    expect(api.payJob).not.toHaveBeenCalled();
  });

  it('a fee-payment átmeneti hibája (5xx) után újrapróbál — CIB-módban nem ragad a stub-felületen', async () => {
    vi.useFakeTimers();
    vi.mocked(api.getFeePayment)
      .mockRejectedValueOnce(Object.assign(new Error('x'), { status: 503 }))
      .mockResolvedValue(CIB as any);
    kartya();
    await act(async () => { await vi.advanceTimersByTimeAsync(0); });
    expect(screen.queryByText('Kártyás fizetés szolgáltatója:')).toBeNull();
    await act(async () => { await vi.advanceTimersByTimeAsync(2_100); });
    expect(screen.getByText('Kártyás fizetés szolgáltatója:')).toBeInTheDocument();
    expect(api.getFeePayment).toHaveBeenCalledTimes(2);
  });

  it('404-re (nincs CIB-végpont) nincs újrapróba', async () => {
    vi.useFakeTimers();
    vi.mocked(api.getFeePayment).mockRejectedValue(Object.assign(new Error('nincs'), { status: 404 }));
    kartya();
    await act(async () => { await vi.advanceTimersByTimeAsync(60_000); });
    expect(api.getFeePayment).toHaveBeenCalledTimes(1);
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

// A CIB írásos válasza (2026-10-01): az adattovábbítási hozzájárulás
// kötelező, akkor is, ha vásárlói adatot nem küldünk. Külön, előre ki nem
// pipált jelölőnégyzet, szó szerint a banki szöveggel — a 45/2014-es
// nyilatkozat mellett, nem helyette.
describe('CIB adattovábbítási nyilatkozat (második jelölőnégyzet)', () => {
  const nyilatkozatDoboz = () => screen.getByRole('checkbox', { name: /^Kijelentem, hogy az adatkezeléshez/ });
  const teljesitesDoboz = () => screen.getByRole('checkbox', { name: /azonnali teljesítését/ });

  it('a szöveg szó szerint a bank által kért mondat', () => {
    expect(CIB_ADATKEZELESI_NYILATKOZAT).toBe(
      'Kijelentem, hogy az adatkezeléshez kapcsolódó tájékoztatást megértettem és tudomásul vettem. '
      + 'Ezennel önkéntesen és megfelelő tájékoztatás birtokában hozzájárulok ahhoz, hogy a Tiszta Hód Kft. '
      + 'az önkéntesen megadott személyes adataimat az Adatkezelési tájékoztatóban meghatározott célból '
      + 'továbbítsa a CIB Bank Zrt. részére.',
    );
    expect(CIB_ADATKEZELESI_LINK).toEqual({ szoveg: 'Adatkezelési tájékoztató', href: '/adatkezeles#cib-kartyas-fizetes' });
  });

  it('stub-módban nincs második jelölőnégyzet (a mai felület)', async () => {
    vi.mocked(api.getFeePayment).mockResolvedValue(STUB as any);
    kartya();
    await screen.findByRole('button', { name: /Díj fizetése/ });
    expect(screen.getAllByRole('checkbox')).toHaveLength(1);
    expect(screen.queryByText(/Kijelentem, hogy az adatkezeléshez/)).toBeNull();
  });

  it('CIB-módban külön, előre ki nem pipált jelölőnégyzet a szó szerinti szöveggel és a CIB-szakaszra mutató linkkel', async () => {
    vi.mocked(api.getFeePayment).mockResolvedValue(CIB as any);
    kartya();
    await screen.findByText('Kártyás fizetés szolgáltatója:');
    expect(screen.getAllByRole('checkbox')).toHaveLength(2);
    expect(nyilatkozatDoboz()).not.toBeChecked();
    expect(teljesitesDoboz()).not.toBeChecked();
    expect(nyilatkozatDoboz()).not.toBe(teljesitesDoboz());
    const szoveg = screen.getByTestId('cib-adatkezelesi-szoveg');
    expect(szoveg.textContent).toBe(CIB_ADATKEZELESI_NYILATKOZAT);
    const link = within(szoveg).getByRole('link', { name: 'Adatkezelési tájékoztató' });
    expect(link).toHaveAttribute('href', '/adatkezeles#cib-kartyas-fizetes');
    // A 45/2014-es nyilatkozat szövege változatlanul megvan.
    expect(screen.getByTestId('fee-consent-szoveg').textContent).toMatch(/45\/2014\. Korm\. rendelet 29\. § \(1\) a\)/);
  });

  it('a fizetés gombja csak MINDKÉT pipa után nyomható', async () => {
    vi.mocked(api.getFeePayment).mockResolvedValue(CIB as any);
    vi.mocked(api.payJob).mockResolvedValue({
      provider: 'cib', redirect_url: 'https://api.gofuvar.hu/payments/cib/tovabb/tok', gateway_url: null, fee_huf: 500,
    } as any);
    kartya();
    const gomb = await screen.findByRole('button', { name: /Fizetés bankkártyával/ });
    expect(gomb).toBeDisabled();
    fireEvent.click(teljesitesDoboz());
    expect(gomb, 'csak a 45/2014-es nyilatkozattal már fizethetett').toBeDisabled();
    fireEvent.click(gomb);
    expect(api.payJob).not.toHaveBeenCalled();
    fireEvent.click(teljesitesDoboz());
    fireEvent.click(nyilatkozatDoboz());
    expect(gomb, 'csak az adattovábbítási nyilatkozattal már fizethetett').toBeDisabled();
    fireEvent.click(teljesitesDoboz());
    expect(gomb).not.toBeDisabled();
    fireEvent.click(gomb);
    await waitFor(() => expect(api.payJob).toHaveBeenCalledWith('job-1', true, true));
  });

  it('zsákutca ellen: ha a fee-payment nem töltött be (stub-felület), a CIB_CONSENT_REQUIRED újraolvassa az állapotot, és megjelenik a nyilatkozat', async () => {
    // 2026-10-01 (a PR-4 1. javítóköre): a fee-payment 404-e után a kártya a
    // stub-felületet mutatja (egy jelölőnégyzet), a /pay viszont CIB-úton
    // fut, és 400 CIB_CONSENT_REQUIRED-et ad — eddig az állapot nem töltődött
    // újra, a kért nyilatkozat oldal-újratöltésig nem jelent meg.
    vi.mocked(api.getFeePayment)
      .mockRejectedValueOnce(Object.assign(new Error('nincs'), { status: 404 }))
      .mockResolvedValue(CIB as any);
    vi.mocked(api.payJob).mockRejectedValue(Object.assign(new Error('x'), { code: 'CIB_CONSENT_REQUIRED', status: 400 }));
    kartya();
    await screen.findByRole('button', { name: /Díj fizetése/ });
    expect(screen.getAllByRole('checkbox')).toHaveLength(1);
    await pipalEsFizet(/Díj fizetése/);
    await waitFor(() => expect(api.getFeePayment).toHaveBeenCalledTimes(2));
    expect(await screen.findByRole('checkbox', { name: /^Kijelentem, hogy az adatkezeléshez/ })).not.toBeChecked();
    expect(screen.getAllByRole('checkbox')).toHaveLength(2);
  });

  it('a backend CIB_CONSENT_REQUIRED kódja saját magyar szöveget kap (a szerver üzenete nem jut át)', async () => {
    vi.mocked(api.getFeePayment).mockResolvedValue(CIB as any);
    vi.mocked(api.payJob).mockRejectedValue(Object.assign(new Error('SZERVER-SZÖVEG'), { code: 'CIB_CONSENT_REQUIRED', status: 400 }));
    kartya();
    await screen.findByText('Kártyás fizetés szolgáltatója:');
    await pipalEsFizet(/Fizetés bankkártyával/);
    const doboz = await screen.findByRole('alert');
    expect(doboz.textContent).toMatch(/CIB Bank felé történő adattovábbításról/);
    expect(document.body.textContent).not.toMatch(/SZERVER-SZÖVEG/);
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
    mindentPipal();
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
    // A „feldolgozas" egy másik fülben épp induló kísérlet is lehet — a doboz
    // nem állíthatja, hogy a bank már jóváhagyta a fizetést.
    expect(document.body.textContent).not.toMatch(/jóváhagyta/);
  });

  it('SIKERES fizetés a lezárás után: a fuvar EGYSZER frissül, a lekérdezés leáll, fizetés-gomb nincs', async () => {
    vi.useFakeTimers();
    const onFrissites = vi.fn();
    vi.mocked(api.getFeePayment)
      .mockResolvedValueOnce({
        ...CIB, can_pay: false, open_attempt: { trid: '1111222233334444', started_at: new Date().toISOString(), allapot: 'feldolgozas' },
      } as any)
      .mockResolvedValue({
        ...CIB, can_pay: false, open_attempt: null, last_result: {
          trid: '1111222233334444', rc: '00', rt: 'Sikeres tranzakció', amo: 500, cur: 'HUF', anum: 'AB1234',
          rc_csoport: null, allapot: 'sikeres',
        },
      } as any);
    kartya({ onFrissites });
    await act(async () => { await vi.advanceTimersByTimeAsync(0); });
    expect(screen.getByText(/A fizetés lezárása folyamatban/)).toBeInTheDocument();
    expect(onFrissites).not.toHaveBeenCalled();

    await act(async () => { await vi.advanceTimersByTimeAsync(5_100); });
    expect(screen.getByText('Sikeres fizetés')).toBeInTheDocument();
    expect(screen.queryByText(/A fizetés lezárása folyamatban/)).toBeNull();
    expect(onFrissites).toHaveBeenCalledTimes(1);

    // A lekérdezés leállt: sem új kérés, sem újabb frissítés.
    const hivasok = vi.mocked(api.getFeePayment).mock.calls.length;
    await act(async () => { await vi.advanceTimersByTimeAsync(60_000); });
    expect(api.getFeePayment).toHaveBeenCalledTimes(hivasok);
    expect(onFrissites).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole('button', { name: /Fizetés bankkártyával/ })).toBeNull();
    expect(screen.queryByRole('checkbox')).toBeNull();
  });

  it('már SIKERES díjfizetés betöltéskor: a fuvar egyszer frissül, nincs lekérdezési ciklus', async () => {
    vi.useFakeTimers();
    const onFrissites = vi.fn();
    vi.mocked(api.getFeePayment).mockResolvedValue({
      ...CIB, can_pay: false, last_result: { trid: '1', rc: '00', allapot: 'sikeres' },
    } as any);
    kartya({ onFrissites });
    await act(async () => { await vi.advanceTimersByTimeAsync(0); });
    expect(onFrissites).toHaveBeenCalledTimes(1);
    await act(async () => { await vi.advanceTimersByTimeAsync(60_000); });
    expect(api.getFeePayment).toHaveBeenCalledTimes(1);
    expect(onFrissites).toHaveBeenCalledTimes(1);
  });

  it('Vissza a bank oldaláról (bfcache): a gomb újra nyomható, az állapot újraolvasva', async () => {
    vi.mocked(api.getFeePayment).mockResolvedValue(CIB as any);
    vi.mocked(api.payJob).mockResolvedValue({
      provider: 'cib', redirect_url: 'https://api.gofuvar.hu/payments/cib/tovabb/tok', gateway_url: null, fee_huf: 500,
    } as any);
    kartya();
    await screen.findByText('Kártyás fizetés szolgáltatója:');
    await pipalEsFizet(/Fizetés bankkártyával/);
    expect(await screen.findByRole('button', { name: /Átirányítás a CIB Bankhoz/ })).toBeDisabled();
    const elotte = vi.mocked(api.getFeePayment).mock.calls.length;

    // Nem gyorsítótárból jövő pageshow: semmi nem változik.
    act(() => { window.dispatchEvent(Object.assign(new Event('pageshow'), { persisted: false })); });
    expect(screen.getByRole('button', { name: /Átirányítás a CIB Bankhoz/ })).toBeDisabled();

    act(() => { window.dispatchEvent(Object.assign(new Event('pageshow'), { persisted: true })); });
    expect(await screen.findByRole('button', { name: /Fizetés bankkártyával/ })).not.toBeDisabled();
    await waitFor(() => expect(vi.mocked(api.getFeePayment).mock.calls.length).toBeGreaterThan(elotte));
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

  it('?fizetes=link-lejart → toast: a link már nem használható', async () => {
    // 2026-10-04 (W2): a backend a szünet és a másik kísérlet miatt nem
    // használható linkről is ide küld — „indíts újat" nem ígérhető (cib-pr5-w2).
    window.history.replaceState({}, '', '/dashboard/fuvar/job-1?fizetes=link-lejart');
    vi.mocked(api.getFeePayment).mockResolvedValue(CIB as any);
    kartya();
    await waitFor(() => expect(m.toast.info).toHaveBeenCalledWith(
      expect.any(String), expect.stringMatching(/már nem használható/),
    ));
  });
});
