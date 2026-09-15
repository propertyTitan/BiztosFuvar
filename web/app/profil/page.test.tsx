import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { beforeEach, afterEach, expect, it, vi } from 'vitest';
import Page from './page';

const mocks = vi.hoisted(() => ({
  user: { id: 'profile-user' }, router: { push: vi.fn() },
  toast: { info: vi.fn(), error: vi.fn(), success: vi.fn() }, update: vi.fn(),
}));
vi.mock('next/navigation', () => ({ useRouter: () => mocks.router }));
vi.mock('@/lib/auth', () => ({ useCurrentUser: () => mocks.user, setCurrentUser: vi.fn(), frissitCurrentUser: mocks.update }));
vi.mock('@/components/ToastProvider', () => ({ useToast: () => mocks.toast }));
vi.mock('@/components/ReferralCard', () => ({ default: () => null }));
vi.mock('@/components/TaxDataCard', () => ({ default: () => null }));
const originalFetch = global.fetch;
beforeEach(() => { vi.resetAllMocks(); localStorage.setItem('gofuvar_token', 'profile-token'); });
afterEach(() => { global.fetch = originalFetch; });

it('a profiloldal tényleges avatarkérése időkerettel indul, és frissíti a fejlécet', async () => {
  const fetchMock = vi.fn(async (url: RequestInfo | URL, _init?: RequestInit) => ({ ok: true, status: 200, json: async () => String(url).endsWith('/auth/avatar')
    ? { url: '/uploads/uj-avatar.jpg' }
    : { id: 'profile-user', full_name: 'Teszt Feladó', created_at: '2026-09-01T12:00:00Z' },
  } as Response));
  global.fetch = fetchMock;
  render(<Page />);
  const input = await screen.findByLabelText('Profilkép feltöltése');
  const file = new File(['photo'], 'avatar.jpg', { type: 'image/jpeg' });
  fireEvent.change(input, { target: { files: [file] } });
  await waitFor(() => expect(mocks.update).toHaveBeenCalledWith({ avatar_url: '/uploads/uj-avatar.jpg' }));
  const call = fetchMock.mock.calls.find(([url]) => String(url).endsWith('/auth/avatar'))!;
  const init = call[1]!;
  expect(init.signal).toBeInstanceOf(AbortSignal);
  expect(new Headers(init.headers).get('Content-Type')).toBeNull();
  expect(new Headers(init.headers).get('Authorization')).toBe('Bearer profile-token');
  expect((init.body as FormData).get('file')).toBe(file);
  expect(mocks.toast.success).toHaveBeenCalledWith('Profilkép mentve!');
});
