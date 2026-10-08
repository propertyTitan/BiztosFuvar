// Fejléc + lábléc a látogatónak (UX-kör, 2026-10-08):
//  - Q10: a kínálati oldalnak (szállítóknak) is van azonnali bejárata a fejlécben;
//  - A10: a belépési oldalon a fejléc „Belépés" gombja nem jelenik meg (két
//    „Belépés" egymás alatt, ugyanoda vinne, ahol már vagyunk);
//  - A9: az AI-asszisztens belépéshez kötött — a lábléc ezt kimondja, és a
//    belépés után oda visz (eddig szó nélkül a belépésre dobott).
import { render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import SiteHeader from './SiteHeader';
import SiteFooter from './SiteFooter';

const m = vi.hoisted(() => ({ ut: '/' }));
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
  usePathname: () => m.ut,
}));
vi.mock('@/api', () => ({
  api: { unreadNotificationCount: vi.fn().mockResolvedValue({ count: 0 }), getMyProfile: vi.fn() },
  photoUrl: (u: string) => u,
}));
vi.mock('@/lib/socket', () => ({
  getSocket: () => ({ on: vi.fn(), off: vi.fn() }),
  joinUserRoom: vi.fn(),
  disconnectSocket: vi.fn(),
  refreshSocketAuth: vi.fn(),
}));

beforeEach(() => {
  localStorage.clear();
  m.ut = '/';
});

describe('fejléc a látogatónak', () => {
  it('„Szállítóknak" link a /soforoknek oldalra, mellette a Belépés gomb', () => {
    render(<SiteHeader />);
    expect(screen.getByRole('link', { name: 'Szállítóknak' })).toHaveAttribute('href', '/soforoknek');
    expect(screen.getByRole('link', { name: 'Belépés' })).toHaveAttribute('href', '/bejelentkezes');
  });

  it('a belépési oldalon a fejléc nem mutat „Belépés" gombot', () => {
    m.ut = '/bejelentkezes';
    render(<SiteHeader />);
    expect(screen.queryByRole('link', { name: 'Belépés' })).toBeNull();
  });
});

describe('lábléc: AI-asszisztens', () => {
  it('látogatónak kimondja, hogy belépés kell, és a belépés után oda visz', () => {
    render(<SiteFooter />);
    const link = screen.getByRole('link', { name: 'AI-asszisztens (belépés után)' });
    const url = new URL(link.getAttribute('href')!, 'https://x.hu');
    expect(url.pathname).toBe('/bejelentkezes');
    expect(url.searchParams.get('next')).toBe('/ai-chat');
  });

  it('belépett felhasználónak közvetlenül az AI-segédre visz', async () => {
    localStorage.setItem('gofuvar_user', JSON.stringify({ id: 'u1', email: 'a@teszt.hu', role: 'shipper' }));
    render(<SiteFooter />);
    expect(await screen.findByRole('link', { name: 'AI-asszisztens' })).toHaveAttribute('href', '/ai-chat');
  });
});
