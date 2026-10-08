// =====================================================================
//  AI-GOMB MOBILON — UX-kör A9 (2026-10-08)
//
//  A 60 px-es, 🤖 emojis lebegő gomb mobilon a döntéshez szükséges adatokat
//  és a beküldő gombokat takarta: a saját /ai-chat oldalán a Küldés gombot,
//  a szállítói kártyák méretadatát, a fuvar-részleteket. A javítás:
//   - az /ai-chat oldalon egyáltalán nincs lebegő gomb,
//   - mobilon csak a hubon és a listaoldalakon (CSS: .ai-fab--mobil-rejtett),
//   - nyitott billentyűzetnél (szövegmező fókuszban) sem,
//   - lucide ikon, aria-expanded, a pozíció CSS-osztályban (a mobil
//     média-lekérdezés inline stílust nem tudna felülírni).
// =====================================================================
import { act, fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import AiChatWidget, { aiGombMobilonLathato } from './AiChatWidget';

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

async function gomb() {
  return screen.findByRole('button', { name: 'AI segéd megnyitása' });
}

describe('hol látszik a lebegő AI-gomb', () => {
  it('a teljes oldalas AI-segéden nincs lebegő gomb (eltakarta a Küldést)', async () => {
    m.ut = '/ai-chat';
    render(<AiChatWidget />);
    await act(async () => { await new Promise((r) => setTimeout(r, 0)); });
    expect(screen.queryByRole('button', { name: 'AI segéd megnyitása' })).toBeNull();
  });

  it('mobilon csak a hubon és a listaoldalakon', () => {
    expect(aiGombMobilonLathato('/')).toBe(true);
    expect(aiGombMobilonLathato('/fuvarjaim')).toBe(true);
    expect(aiGombMobilonLathato('/sofor/fuvarok')).toBe(true);
    expect(aiGombMobilonLathato('/dashboard/uj-fuvar')).toBe(false);
    expect(aiGombMobilonLathato('/dashboard/fuvar/abc')).toBe(false);
    expect(aiGombMobilonLathato('/sofor/fuvar/abc')).toBe(false);
    expect(aiGombMobilonLathato('/profil')).toBe(false);
    expect(aiGombMobilonLathato('/bejelentkezes')).toBe(false);
  });

  it('fuvar-részletoldalon a gomb mobilon rejtett (asztalon marad)', async () => {
    m.ut = '/dashboard/fuvar/job-1';
    render(<AiChatWidget />);
    const g = await gomb();
    expect(g).toHaveClass('ai-fab');
    expect(g).toHaveClass('ai-fab--mobil-rejtett');
  });

  it('a hubon a gomb mobilon is látszik — amíg nem gépelünk', async () => {
    m.ut = '/';
    render(
      <>
        <input aria-label="kereső" />
        <AiChatWidget />
      </>,
    );
    const g = await gomb();
    expect(g).not.toHaveClass('ai-fab--mobil-rejtett');
    // Nyitott billentyűzet: egy szövegmező fókuszban → a gomb nem takarhat.
    act(() => { screen.getByLabelText('kereső').focus(); });
    expect(g).toHaveClass('ai-fab--mobil-rejtett');
    act(() => { (document.activeElement as HTMLElement).blur(); });
    expect(g).not.toHaveClass('ai-fab--mobil-rejtett');
  });
});

describe('a gomb maga', () => {
  it('lucide ikon (nem emoji), aria-expanded, a pozíció CSS-osztályban', async () => {
    m.ut = '/';
    render(<AiChatWidget />);
    const g = await gomb();
    expect(g.textContent, 'UI-ikonként emoji TILOS (CLAUDE.md design-szabály)').not.toMatch(/🤖|×/);
    expect(g.querySelector('svg')).not.toBeNull();
    expect(g).toHaveAttribute('aria-expanded', 'false');
    expect(g.getAttribute('style'), 'inline pozíció: a mobil média-lekérdezés nem írná felül').toBeNull();
    fireEvent.click(g);
    expect(screen.getByRole('button', { name: 'Bezár' })).toHaveAttribute('aria-expanded', 'true');
    expect(screen.getByRole('dialog', { name: 'GoFuvar Segéd' })).toHaveClass('ai-panel');
    // Nyitott állapotban mobilon az alsó lap saját bezáró gombja szolgál.
    expect(screen.getByRole('button', { name: 'Bezár' })).toHaveClass('ai-fab--mobil-rejtett');
  });
});
