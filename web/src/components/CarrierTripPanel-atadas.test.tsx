// UX-review Q15 + Q16 (2026-10-08): a kézbesítés elakadásai és a díjra várás.
//  - hibás kódra nem „Sikertelen kézbesítés” (az a visszaszállítási
//    nyilatkozatban mást jelent), hanem teendő + a maradék próbálkozások;
//  - a fájlnév helyett bélyegkép „Másik fotó” gombbal;
//  - „Nem sikerül átadni?” kiút (hívás, vállalás, probléma bejelentése);
//  - a díjra váró szállító megtudja, meddig vár és mi lesz.
// A régi CarrierTripPanellel a komponens-tesztek pirosak.
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import CarrierTripPanel, { kezbesitesiHiba } from './CarrierTripPanel';

const toast = { success: vi.fn(), error: vi.fn(), info: vi.fn() };
vi.mock('./ToastProvider', () => ({ useToast: () => toast }));
const uploadJobPhoto = vi.fn();
vi.mock('@/api', () => ({ api: { uploadJobPhoto: (...a: any[]) => uploadJobPhoto(...a) } }));

beforeEach(() => { vi.clearAllMocks(); });
const file = () => new File(['x'], 'csomag.jpg', { type: 'image/jpeg' });

describe('kezbesitesiHiba', () => {
  it('a backend „még N próbálkozás” üzenetéből teendőt és számot ad', () => {
    expect(kezbesitesiHiba('Érvénytelen átvételi kód (még 4 próbálkozás)')).toEqual({
      cim: 'Hibás átvételi kód',
      szoveg: 'Kérd el újra az átvevőtől. Még 4 próbálkozásod van.',
      kodGond: true,
    });
  });
  it('zárolásnál a zárolást mondja', () => {
    expect(kezbesitesiHiba('Érvénytelen átvételi kód — túl sok hibás próbálkozás, a kód-ellenőrzés 1 órára zárolva.').cim)
      .toBe('A kód-ellenőrzés zárolva');
  });
  it('más hibánál semleges cím, soha nem „Sikertelen kézbesítés”', () => {
    const h = kezbesitesiHiba('A fotó feltöltése lejárt. Töltsd fel újra.');
    expect(h.cim).toBe('Nem sikerült igazolni a kézbesítést');
    expect(h.kodGond).toBe(false);
  });
});

describe('CarrierTripPanel — kézbesítés', () => {
  it('hibás kódra a toast „Hibás átvételi kód” + maradék próbálkozás, a mező alatt is', async () => {
    uploadJobPhoto.mockRejectedValue(new Error('Érvénytelen átvételi kód (még 4 próbálkozás)'));
    const user = userEvent.setup();
    render(<CarrierTripPanel jobId="j1" status="in_progress" paid onDone={vi.fn()} />);
    await user.upload(document.getElementById('dropoff-photo') as HTMLInputElement, file());
    await user.type(screen.getByPlaceholderText('6 számjegy'), '123456');
    await user.click(screen.getByRole('button', { name: /Kézbesítés igazolása/ }));
    expect(toast.error).toHaveBeenCalledWith('Hibás átvételi kód', 'Kérd el újra az átvevőtől. Még 4 próbálkozásod van.');
    expect(toast.error).not.toHaveBeenCalledWith('Sikertelen kézbesítés', expect.anything());
    expect(screen.getByRole('alert').textContent).toMatch(/Még 4 próbálkozásod van/);
  });

  it('a kiválasztott fotó helyén bélyegkép és „Másik fotó” gomb, nem csak a fájlnév', async () => {
    const eredeti = URL.createObjectURL;
    URL.createObjectURL = vi.fn(() => 'blob:foto');
    URL.revokeObjectURL = vi.fn();
    try {
      const user = userEvent.setup();
      render(<CarrierTripPanel jobId="j1" status="in_progress" paid onDone={vi.fn()} />);
      await user.upload(document.getElementById('dropoff-photo') as HTMLInputElement, file());
      expect(screen.getByRole('img', { name: /kézbesítési fotó előnézete/ })).toHaveAttribute('src', 'blob:foto');
      expect(screen.getByText('Másik fotó')).toBeInTheDocument();
    } finally {
      URL.createObjectURL = eredeti;
    }
  });

  it('a kódmező alatt útmutató + a feladó hívása, ha a díj után ismert a száma', () => {
    render(<CarrierTripPanel jobId="j1" status="in_progress" paid onDone={vi.fn()} feladoTelefon="+36301234567" />);
    expect(screen.getByText(/Nincs kódja az átvevőnek\?/)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /Feladó hívása/ })).toHaveAttribute('href', 'tel:+36301234567');
  });

  it('„Nem sikerül átadni?” — hívások, a vállalás és a probléma bejelentése', () => {
    render(
      <CarrierTripPanel
        jobId="j1" status="in_progress" paid onDone={vi.fn()}
        feladoTelefon="+36301234567" cimzettTelefon="+36307654321"
        vallalas={{ return_policy: 'extra_fee', return_fee_huf: 3000 }}
        problemaHref="#problema-bejelentese"
      />,
    );
    expect(screen.getByText('Nem sikerül átadni?')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: '+36307654321', hidden: true })).toHaveAttribute('href', 'tel:+36307654321');
    expect(screen.getByText(/A vállalásod:.*külön díjért \(3\s?000 Ft\)/)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Probléma bejelentése', hidden: true })).toHaveAttribute('href', '#problema-bejelentese');
  });
});

describe('CarrierTripPanel — díjfizetésre vár', () => {
  it('megmondja, mi lesz, ha a feladó nem fizet, és hogy a cím/telefon a díj után jár', () => {
    render(<CarrierTripPanel jobId="j1" status="accepted" paid={false} onDone={vi.fn()} />);
    expect(screen.getByText(/kétszer emlékeztetjük/)).toBeInTheDocument();
    expect(screen.getByText(/automatikusan lezárul/)).toBeInTheDocument();
    expect(screen.getByText(/pontos címet és a feladó telefonszámát a díj után látod/)).toBeInTheDocument();
  });

  it('foglalásnál nincs lejárati ígéret (ott nincs ilyen kör)', () => {
    render(<CarrierTripPanel jobId="b1" status="confirmed" paid={false} onDone={vi.fn()} entity="booking" />);
    expect(screen.queryByText(/kétszer emlékeztetjük/)).toBeNull();
  });
});

describe('CarrierTripPanel — felvétel (A01)', () => {
  it('a felvételkor a kódot nem kéri: azt az átadáskor kapja meg', () => {
    render(<CarrierTripPanel jobId="j1" status="accepted" paid onDone={vi.fn()} />);
    expect(screen.getByText('Az átvételi kódot most ne kérd: azt az átadáskor kapod meg.')).toBeInTheDocument();
  });
});
