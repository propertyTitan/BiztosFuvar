import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import ReviewBox from './ReviewBox';

// A toast API-t és a backend api-t mockoljuk, hogy a komponens viselkedését
// (validáció + küldés) izoláltan tudjuk vizsgálni.
const toast = { success: vi.fn(), error: vi.fn(), info: vi.fn() };
vi.mock('@/components/ToastProvider', () => ({ useToast: () => toast }));

const getReviews = vi.fn();
const submitReview = vi.fn();
vi.mock('@/api', () => ({ api: { getReviews: (...a: any[]) => getReviews(...a), submitReview: (...a: any[]) => submitReview(...a) } }));

beforeEach(() => {
  vi.clearAllMocks();
  getReviews.mockResolvedValue([]);
  submitReview.mockResolvedValue({});
  window.localStorage.clear();
});

describe('ReviewBox', () => {
  it('csillag nélkül küldve hibát jelez és nem hív API-t', async () => {
    const user = userEvent.setup();
    render(<ReviewBox entityKey="job_id" entityId="j1" />);
    await waitFor(() => expect(getReviews).toHaveBeenCalled());

    await user.click(screen.getByText('Válassz csillagot'));

    expect(toast.error).toHaveBeenCalledWith('Hiányzó értékelés', expect.any(String));
    expect(submitReview).not.toHaveBeenCalled();
  });

  it('csillag kiválasztása után elküldi az értékelést', async () => {
    const user = userEvent.setup();
    const onDone = vi.fn();
    render(<ReviewBox entityKey="job_id" entityId="j1" onDone={onDone} />);
    await waitFor(() => expect(getReviews).toHaveBeenCalled());

    // 4. csillag (a csillag-gombok a ★ unicode karakterrel vannak felirat nélkül)
    const starButtons = screen.getAllByRole('button').filter((b) => b.textContent === String.fromCodePoint(0x2605));
    await user.click(starButtons[3]);

    await user.click(screen.getByText('4 csillag — Értékelés küldése'));

    await waitFor(() => expect(submitReview).toHaveBeenCalledWith({ job_id: 'j1', stars: 4, comment: undefined }));
    expect(toast.success).toHaveBeenCalled();
    expect(onDone).toHaveBeenCalled();
  });
});
