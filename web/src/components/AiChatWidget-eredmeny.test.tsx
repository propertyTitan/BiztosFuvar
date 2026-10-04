// A lebegő AI-gomb mobilon (390 px) eltakarta az eredménykártya utolsó
// bekezdését — a banki adatsor és a „Vissza a fuvarhoz" környékét. Az
// eredményoldalon ezért nem jelenik meg (CIB PR-5, 2026-10-03).
import { render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import AiChatWidget from './AiChatWidget';

const m = vi.hoisted(() => ({ ut: '/' }));
vi.mock('@/api', () => ({ api: { aiChat: vi.fn() } }));
vi.mock('@/lib/socket', () => ({ disconnectSocket: vi.fn(), refreshSocketAuth: vi.fn() }));
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
  usePathname: () => m.ut,
}));

beforeEach(() => {
  localStorage.clear();
  localStorage.setItem('gofuvar_user', JSON.stringify({ id: 'u1', email: 'a@teszt.hu', role: 'shipper' }));
  localStorage.setItem('gofuvar_token', 't');
  localStorage.setItem('gofuvar_cookie_consent', 'accepted');
});

describe('AI-gomb az eredményoldalon', () => {
  it('máshol látszik', async () => {
    m.ut = '/dashboard/fuvar/job-1';
    render(<AiChatWidget />);
    expect(await screen.findByRole('button', { name: /AI segéd megnyitása/ })).toBeInTheDocument();
  });

  it('a /fizetes/eredmeny oldalon nem takarja el a kártyát', async () => {
    m.ut = '/fizetes/eredmeny';
    render(<AiChatWidget />);
    await new Promise((r) => setTimeout(r, 0));
    expect(screen.queryByRole('button', { name: /AI segéd megnyitása/ })).toBeNull();
  });
});
