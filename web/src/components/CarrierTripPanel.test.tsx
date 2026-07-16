import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import CarrierTripPanel from './CarrierTripPanel';

// Szállítói fuvar-panel: felvétel (fotó) és kézbesítés (fotó + 6 jegyű kód).
// A validáció hibaüzeneteit és a sikeres feltöltést teszteljük.
const toast = { success: vi.fn(), error: vi.fn(), info: vi.fn() };
vi.mock('./ToastProvider', () => ({ useToast: () => toast }));

const uploadJobPhoto = vi.fn();
vi.mock('@/api', () => ({ api: { uploadJobPhoto: (...a: any[]) => uploadJobPhoto(...a) } }));

beforeEach(() => {
  vi.clearAllMocks();
  uploadJobPhoto.mockResolvedValue({});
});

const file = () => new File(['x'], 'csomag.jpg', { type: 'image/jpeg' });

describe('CarrierTripPanel — felvétel (accepted)', () => {
  it('fotó nélkül hibát jelez, nem tölt fel', async () => {
    const user = userEvent.setup();
    render(<CarrierTripPanel jobId="j1" status="accepted" paid onDone={vi.fn()} />);

    await user.click(screen.getByText(/Felvétel igazolása/));

    expect(toast.error).toHaveBeenCalledWith('Hiányzó fotó', expect.any(String));
    expect(uploadJobPhoto).not.toHaveBeenCalled();
  });

  it('fotóval feltölti és jelzi a szülőnek', async () => {
    const user = userEvent.setup();
    const onDone = vi.fn();
    render(<CarrierTripPanel jobId="j1" status="accepted" paid onDone={onDone} />);

    await user.upload(document.getElementById('pickup-photo') as HTMLInputElement, file());
    await user.click(screen.getByText(/Felvétel igazolása/));

    expect(uploadJobPhoto).toHaveBeenCalledWith('j1', expect.any(File), 'pickup');
    expect(onDone).toHaveBeenCalled();
  });
});

describe('CarrierTripPanel — kézbesítés (in_progress)', () => {
  it('fotó nélkül "Hiányzó fotó"', async () => {
    const user = userEvent.setup();
    render(<CarrierTripPanel jobId="j1" status="in_progress" paid onDone={vi.fn()} />);

    await user.click(screen.getByRole('button', { name: /Kézbesítés igazolása/ }));

    expect(toast.error).toHaveBeenCalledWith('Hiányzó fotó', expect.any(String));
    expect(uploadJobPhoto).not.toHaveBeenCalled();
  });

  it('fotóval de hibás (rövid) kóddal "Hibás kód"', async () => {
    const user = userEvent.setup();
    render(<CarrierTripPanel jobId="j1" status="in_progress" paid onDone={vi.fn()} />);

    await user.upload(document.getElementById('dropoff-photo') as HTMLInputElement, file());
    await user.type(screen.getByPlaceholderText('••••••'), '1234');
    await user.click(screen.getByRole('button', { name: /Kézbesítés igazolása/ }));

    expect(toast.error).toHaveBeenCalledWith('Hibás kód', expect.any(String));
    expect(uploadJobPhoto).not.toHaveBeenCalled();
  });

  it('fotóval + 6 jegyű kóddal lezárja a fuvart', async () => {
    const user = userEvent.setup();
    const onDone = vi.fn();
    render(<CarrierTripPanel jobId="j1" status="in_progress" paid onDone={onDone} />);

    await user.upload(document.getElementById('dropoff-photo') as HTMLInputElement, file());
    await user.type(screen.getByPlaceholderText('••••••'), '123456');
    await user.click(screen.getByRole('button', { name: /Kézbesítés igazolása/ }));

    expect(uploadJobPhoto).toHaveBeenCalledWith('j1', expect.any(File), 'dropoff', { deliveryCode: '123456' });
    expect(onDone).toHaveBeenCalled();
  });

  it('ismeretlen státuszra nem renderel semmit', () => {
    const { container } = render(<CarrierTripPanel jobId="j1" status="delivered" paid onDone={vi.fn()} />);
    expect(container).toBeEmptyDOMElement();
  });
});

describe('CarrierTripPanel — fizetetlen fuvar', () => {
  it('accepted + fizetetlen: "Fizetésre vár", nincs feltöltő űrlap', () => {
    render(<CarrierTripPanel jobId="j1" status="accepted" paid={false} onDone={vi.fn()} />);

    expect(screen.getByText(/Fizetésre vár/)).toBeInTheDocument();
    expect(screen.queryByText(/Felvétel igazolása/)).not.toBeInTheDocument();
  });

  it('in_progress + fizetetlen: a kézbesítés sem elérhető', () => {
    render(<CarrierTripPanel jobId="j1" status="in_progress" paid={false} onDone={vi.fn()} />);

    expect(screen.getByText(/Fizetésre vár/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Kézbesítés igazolása/ })).not.toBeInTheDocument();
  });
});
