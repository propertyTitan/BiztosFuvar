import { act, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import EredmenyOldal from '../../app/fizetes/eredmeny/page';
import { api } from '@/api';

// A /fizetes/eredmeny oldal (CIB PR-3): a bank a böngészőt az API-ra küldi
// vissza, onnan aláírt tokennel ide. Az oldal belépés nélkül is mutatja a
// bank által kötelezővé tett adatsort, 3 mp-enként kérdez (3 percig), utána
// 20 mp-enként, és végleges állapotban leáll.
const m = vi.hoisted(() => ({
  params: new URLSearchParams('e=tok-1'),
  user: null as null | { id: string; role: string },
  socket: { on: vi.fn(), off: vi.fn() },
}));
vi.mock('next/navigation', () => ({
  useSearchParams: () => m.params,
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
}));
vi.mock('@/lib/auth', () => ({ useCurrentUser: () => m.user }));
vi.mock('@/lib/socket', () => ({ getSocket: () => m.socket, joinUserRoom: vi.fn() }));
vi.mock('@/components/ToastProvider', () => ({ useToast: () => ({ success: vi.fn(), error: vi.fn(), info: vi.fn() }) }));
vi.mock('@/api', async (orig) => {
  const valodi = await orig<typeof import('@/api')>();
  return { ...valodi, api: { getCibEredmeny: vi.fn(), getFeePayment: vi.fn(), payJob: vi.fn() } };
});

const ALAP = {
  trid: '1234567812345678', rc: '00', rt: 'Sikeres tranzakció', amo: 500, cur: 'HUF', anum: 'AB1234',
  rc_csoport: null, job_id: 'job-1', ujra_fizetheto: false, frissult: null,
};

async function atfolyat(ms = 0) {
  await act(async () => { await vi.advanceTimersByTimeAsync(ms); });
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.useFakeTimers();
  m.params = new URLSearchParams('e=tok-1');
  m.user = null;
});
afterEach(() => { vi.useRealTimers(); });

describe('eredményoldal állapotai', () => {
  it('sikeres: zöld kártya, az öt kötelező felirat az értékekkel, és leáll a lekérdezés', async () => {
    vi.mocked(api.getCibEredmeny).mockResolvedValue({ ...ALAP, allapot: 'sikeres' } as any);
    render(<EredmenyOldal />);
    await atfolyat();
    expect(screen.getByText(/A kapcsolatfelvételi díjat kifizetted, a szállító elérhetősége megnyílt/)).toBeInTheDocument();
    for (const [felirat, ertek] of [
      ['A tranzakció azonosítója (TrID)', '1234567812345678'],
      ['A tranzakció eredményének kódja (RC)', '00'],
      ['A tranzakció eredményének szöveges ismertetése (RT)', 'Sikeres tranzakció'],
      ['A fizetett összeg (AMO)', '500 HUF'],
      ['A kibocsátó bank által adott engedélyszám (ANUM)', 'AB1234'],
    ]) {
      expect(screen.getByText(felirat)).toBeInTheDocument();
      expect(screen.getByText(ertek)).toBeInTheDocument();
    }
    expect(screen.getByText(/Érdemes elmentened ezeket az adatokat/)).toBeInTheDocument();
    // Kijelentkezve (a bank gyakran MÁS böngészőbe küld vissza) a fuvar
    // linkje a belépésen át, `next`-tel visz — különben a fuvaroldal 401-e
    // cél nélkül dobna a belépésre.
    const beleptetve = `/bejelentkezes?next=${encodeURIComponent('/dashboard/fuvar/job-1')}`;
    expect(screen.getByRole('link', { name: /Szállító elérhetőségének megnyitása/ })).toHaveAttribute('href', `/bejelentkezes?next=${encodeURIComponent('/dashboard/fuvar/job-1#elerhetoseg')}`);
    expect(screen.getByRole('link', { name: /Vissza a fuvarhoz/ })).toHaveAttribute('href', beleptetve);
    await atfolyat(30_000);
    expect(api.getCibEredmeny).toHaveBeenCalledTimes(1);
    expect(api.getCibEredmeny).toHaveBeenCalledWith('tok-1');
  });

  it('sikeres, bejelentkezve: a linkek közvetlenül a fuvarra visznek', async () => {
    m.user = { id: 'shipper', role: 'shipper' };
    vi.mocked(api.getCibEredmeny).mockResolvedValue({ ...ALAP, allapot: 'sikeres' } as any);
    render(<EredmenyOldal />);
    await atfolyat();
    expect(screen.getByRole('link', { name: /Szállító elérhetőségének megnyitása/ })).toHaveAttribute('href', '/dashboard/fuvar/job-1#elerhetoseg');
    expect(screen.getByRole('link', { name: /Vissza a fuvarhoz/ })).toHaveAttribute('href', '/dashboard/fuvar/job-1');
  });

  it('tartós (nem 404-es) hiba: néhány próba után kimondja, és kiutat ad — tovább próbálkozik', async () => {
    vi.mocked(api.getCibEredmeny)
      .mockRejectedValueOnce(Object.assign(new Error('x'), { status: 503 }))
      .mockRejectedValueOnce(Object.assign(new Error('x'), { status: 503 }))
      // (A 429 2026-10-03 óta a szerver kérte ideig vár — lásd FizetesEredmeny-pr5.)
      .mockRejectedValueOnce(Object.assign(new Error('x'), { status: 502 }))
      .mockResolvedValue({ ...ALAP, allapot: 'sikeres' } as any);
    render(<EredmenyOldal />);
    await atfolyat();
    expect(screen.queryByText(/Most nem érjük el/)).toBeNull();
    await atfolyat(6_100);
    expect(api.getCibEredmeny).toHaveBeenCalledTimes(3);
    expect(screen.getByText(/Most nem érjük el/)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /Fuvarjaim/ })).toHaveAttribute('href', '/fuvarjaim');
    // Közben tovább kérdez, és a sikeres eredmény felülírja a hibaüzenetet.
    await atfolyat(3_100);
    expect(screen.getByText(/A kapcsolatfelvételi díjat kifizetted/)).toBeInTheDocument();
    expect(screen.queryByText(/Most nem érjük el/)).toBeNull();
  });

  it('felső korlát: 30 perc után az automatikus lekérdezés leáll, „Frissítés" gombbal újraindítható', async () => {
    vi.mocked(api.getCibEredmeny).mockResolvedValue({ ...ALAP, rc: null, anum: null, allapot: 'feldolgozas' } as any);
    render(<EredmenyOldal />);
    await atfolyat();
    await atfolyat(31 * 60_000);
    const leallaskor = vi.mocked(api.getCibEredmeny).mock.calls.length;
    await atfolyat(10 * 60_000);
    expect(api.getCibEredmeny).toHaveBeenCalledTimes(leallaskor);
    const gomb = screen.getByRole('button', { name: /Frissítés/ });
    await act(async () => { gomb.click(); });
    await atfolyat();
    expect(vi.mocked(api.getCibEredmeny).mock.calls.length).toBe(leallaskor + 1);
    // Újraindítás után ismét a rövid ütem jön.
    await atfolyat(3_100);
    expect(vi.mocked(api.getCibEredmeny).mock.calls.length).toBe(leallaskor + 2);
  });

  it('feldolgozás → 3 mp múlva újra kérdez → sikeres, utána nem kérdez tovább', async () => {
    vi.mocked(api.getCibEredmeny)
      .mockResolvedValueOnce({ ...ALAP, rc: null, rt: null, anum: null, allapot: 'feldolgozas' } as any)
      .mockResolvedValue({ ...ALAP, allapot: 'sikeres' } as any);
    render(<EredmenyOldal />);
    await atfolyat();
    expect(screen.getByText(/A bank megerősíti/)).toBeInTheDocument();
    expect(screen.getByText(/Nem kell itt várnod, e-mailt is küldünk/)).toBeInTheDocument();
    await atfolyat(2_900);
    expect(api.getCibEredmeny).toHaveBeenCalledTimes(1);
    await atfolyat(200);
    expect(api.getCibEredmeny).toHaveBeenCalledTimes(2);
    expect(screen.getByText(/A kapcsolatfelvételi díjat kifizetted/)).toBeInTheDocument();
    await atfolyat(60_000);
    expect(api.getCibEredmeny).toHaveBeenCalledTimes(2);
  });

  it('3 perc után 20 mp-es ütem és „Még tart" üzenet', async () => {
    vi.mocked(api.getCibEredmeny).mockResolvedValue({ ...ALAP, rc: null, anum: null, allapot: 'feldolgozas' } as any);
    render(<EredmenyOldal />);
    await atfolyat();
    await atfolyat(181_000);
    const utana = vi.mocked(api.getCibEredmeny).mock.calls.length;
    expect(utana).toBeGreaterThanOrEqual(60);
    expect(screen.getByText(/Még tart/)).toBeInTheDocument();
    await atfolyat(10_000);
    const tiz = vi.mocked(api.getCibEredmeny).mock.calls.length;
    expect(tiz - utana).toBeLessThanOrEqual(1);
    await atfolyat(20_000);
    expect(vi.mocked(api.getCibEredmeny).mock.calls.length - tiz).toBeGreaterThanOrEqual(1);
  });

  it('sikertelen, kijelentkezve: RC-magyarázat, ANUM „–", belépés-és-újrapróba link', async () => {
    vi.mocked(api.getCibEredmeny).mockResolvedValue({
      ...ALAP, rc: '51', rt: 'Nincs fedezet', anum: null, rc_csoport: 'szamla', allapot: 'sikertelen', ujra_fizetheto: true,
    } as any);
    render(<EredmenyOldal />);
    await atfolyat();
    expect(screen.getByText(/A fizetés nem sikerült/)).toBeInTheDocument();
    expect(screen.getByText(/elegendő pénz/)).toBeInTheDocument();
    expect(screen.getByText('–')).toBeInTheDocument();
    const link = screen.getByRole('link', { name: /Belépés és újrapróba/ });
    expect(link.getAttribute('href')).toBe(
      `/bejelentkezes?next=${encodeURIComponent('/dashboard/fuvar/job-1?fizetes=ujra')}`,
    );
    expect(screen.getByRole('link', { name: /Vissza a fuvarhoz/ })).toBeInTheDocument();
  });

  it('sikertelen, bejelentkezve, újrafizethető: beágyazott fizetési kártya (új TrID)', async () => {
    m.user = { id: 'shipper', role: 'shipper' };
    vi.mocked(api.getCibEredmeny).mockResolvedValue({
      ...ALAP, rc: 'X0', rt: '3DS', anum: null, rc_csoport: 'technikai', allapot: 'sikertelen', ujra_fizetheto: true,
    } as any);
    vi.mocked(api.getFeePayment).mockResolvedValue({
      provider_kind: 'cib', can_pay: true, open_attempt: null,
      last_result: { trid: ALAP.trid, rc: 'X0', allapot: 'sikertelen' },
    } as any);
    render(<EredmenyOldal />);
    await atfolyat();
    await atfolyat();
    expect(screen.getByText(/3D Secure/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Fizetés bankkártyával \(500 Ft\)/ })).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: /Belépés és újrapróba/ })).toBeNull();
    // Az előző eredményt az oldal már mutatja — a kártya nem ismétli.
    expect(screen.queryByText(/Az előző fizetési kísérlet nem sikerült/)).toBeNull();
  });

  it('nem terhelt: megnyugtató szöveg', async () => {
    // 2026-10-04 (a PR-5 web 2. javítóköre): a fixtúra eddig RC=00-t vitt át
    // az ALAP-ból — a valódi „nem terhelt" kimenetnek nincs 00-s banki
    // eredménye (az RC=00 + „nem terhelt" a visszatérített kísérlet, ott a
    // „Nem terheltük" hamis volna; őre: cib-pr5-fix2.test.tsx).
    vi.mocked(api.getCibEredmeny).mockResolvedValue({ ...ALAP, rc: null, rt: null, anum: null, allapot: 'nem_terhelt' } as any);
    render(<EredmenyOldal />);
    await atfolyat();
    expect(screen.getByText(/Nem terheltük a kártyádat/)).toBeInTheDocument();
  });

  it('már fizetve: ezt a próbálkozást nem véglegesítettük', async () => {
    vi.mocked(api.getCibEredmeny).mockResolvedValue({ ...ALAP, anum: null, allapot: 'mar_fizetve' } as any);
    render(<EredmenyOldal />);
    await atfolyat();
    expect(screen.getByText(/Ezt a díjat már rendezted; ezt a próbálkozást nem véglegesítettük/)).toBeInTheDocument();
  });

  it('ellenőrzés: „Ne fizess újra" TrID-del, és csak lassan (20 mp) kérdez tovább', async () => {
    // 2026-10-04 (W2): a backend a kétes kísérletet magától is lezárja
    // (csak-olvasó MSGT33) — az oldal ezért nem áll le, de nem is 3 mp-enként
    // kérdez (lib: lekerdezesUtem; az automatikus döntés: cib-pr5-w2.test).
    vi.mocked(api.getCibEredmeny).mockResolvedValue({ ...ALAP, rc: null, anum: null, allapot: 'ellenorzes' } as any);
    render(<EredmenyOldal />);
    await atfolyat();
    expect(screen.getByText(/Ne fizess újra/)).toBeInTheDocument();
    expect(screen.getAllByText('1234567812345678').length).toBeGreaterThan(0);
    await atfolyat(30_000);
    expect(api.getCibEredmeny).toHaveBeenCalledTimes(2);
  });

  it('lejárt / rossz token (404): magyarázat, a lekérdezés leáll', async () => {
    vi.mocked(api.getCibEredmeny).mockRejectedValue(Object.assign(new Error('x'), { status: 404 }));
    render(<EredmenyOldal />);
    await atfolyat();
    expect(screen.getByText(/lejárt vagy érvénytelen/)).toBeInTheDocument();
    await atfolyat(30_000);
    expect(api.getCibEredmeny).toHaveBeenCalledTimes(1);
  });

  it('átmeneti hálózati hiba: nem áll le, újra kérdez', async () => {
    vi.mocked(api.getCibEredmeny)
      .mockRejectedValueOnce(new Error('hálózat'))
      .mockResolvedValue({ ...ALAP, allapot: 'sikeres' } as any);
    render(<EredmenyOldal />);
    await atfolyat();
    await atfolyat(3_100);
    expect(screen.getByText(/A kapcsolatfelvételi díjat kifizetted/)).toBeInTheDocument();
  });

  it.each([
    ['azonositas', /Nem tudtuk azonosítani a bank válaszát/],
    ['link', /Ez a fizetési link már nem érvényes/],
  ])('?hiba=%s: általános magyarázat + Fuvarjaim link, API-hívás nélkül', async (hiba, szoveg) => {
    m.params = new URLSearchParams(`hiba=${hiba}`);
    render(<EredmenyOldal />);
    await atfolyat();
    expect(screen.getByText(szoveg)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /Fuvarjaim/ })).toHaveAttribute('href', '/fuvarjaim');
    expect(api.getCibEredmeny).not.toHaveBeenCalled();
  });
});
