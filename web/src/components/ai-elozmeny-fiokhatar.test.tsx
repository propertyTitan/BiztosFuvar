// =====================================================================
//  AI-ELŐZMÉNY FIÓKHATÁR ŐR — audit P1 R1-7 (2026-09-28)
//
//  A hiba: a teljes oldalas AI segéd (app/ai-chat) FIÓKFÜGGETLEN
//  'gofuvar_ai_history' kulcsba írt, a kijelentkezés nem törölte, a
//  lebegő widget pedig „migrációként" ÁTVETTE ezt a kulcsot, ha az épp
//  belépett fióknak nem volt saját előzménye. Közös böngészőben így a B
//  fiók megkapta az A fiók teljes AI-beszélgetését (és az ment tovább
//  kontextusként a Geminihez). Ugyanaz a hibaosztály, mint a GF-006-os
//  mód-kulcs és a D3-as fuvarpiszkozat — csak az AI-chatre nem terjedt ki.
//
//  Az őr a VALÓDI auth-folyamattal (setCurrentUser / clearCurrentUser)
//  és a VALÓDI két felülettel mér, újratöltés nélküli fiókváltással is.
// =====================================================================
import { act, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { clearCurrentUser, setCurrentUser, type CurrentUser } from '@/lib/auth';
import AiChatWidget from './AiChatWidget';
import AiChatPage from '../../app/ai-chat/page';

const ai = vi.hoisted(() => ({ chat: vi.fn() }));
vi.mock('@/api', () => ({ api: { aiChat: ai.chat } }));
vi.mock('@/lib/socket', () => ({ disconnectSocket: vi.fn(), refreshSocketAuth: vi.fn() }));
vi.mock('next/navigation', () => ({ useRouter: () => ({ push: vi.fn(), replace: vi.fn() }) }));

const A: CurrentUser = { id: 'fiok-a', email: 'a@teszt.hu', role: 'shipper' };
const B: CurrentUser = { id: 'fiok-b', email: 'b@teszt.hu', role: 'shipper' };
const REGI_KULCS = 'gofuvar_ai_history';
const kulcs = (id: string) => `${REGI_KULCS}:${id}`;
const TITOK = 'Anna kérdése: a Kossuth utca 12-be viszem a kanapét';
const VALASZ = 'Anna válasza a Geminitől';

const WIDGET_MEZO = 'Kérdezz…';
const OLDAL_MEZO = 'Kérdezz bármit…';

beforeEach(() => {
  localStorage.clear();
  sessionStorage.clear();
  ai.chat.mockReset();
  // A süti-döntés előtt a widget szándékosan rejtett.
  localStorage.setItem('gofuvar_cookie_consent', 'accepted');
});
afterEach(() => {
  act(() => clearCurrentUser());
});

function belep(u: CurrentUser) {
  act(() => setCurrentUser(u, `token-${u.id}`));
}
function kilep() {
  act(() => clearCurrentUser());
}
function nyitWidget() {
  const gomb = screen.queryByRole('button', { name: 'AI segéd megnyitása' });
  if (gomb) fireEvent.click(gomb);
}
async function kuld(placeholder: string, szoveg: string) {
  const mezo = screen.getByPlaceholderText(placeholder);
  fireEvent.change(mezo, { target: { value: szoveg } });
  await act(async () => { fireEvent.submit(mezo.closest('form')!); });
}
const tarolt = () => Object.keys(localStorage).map((k) => localStorage.getItem(k) ?? '').join('\n');

describe('A lebegő AI-widget nem ad át beszélgetést másik fióknak (R1-7)', () => {
  it('A kijelentkezik, B belép újratöltés nélkül → a widget üres, A szövege sehol', async () => {
    belep(A);
    render(<AiChatWidget />);
    nyitWidget();
    ai.chat.mockResolvedValueOnce({ reply: VALASZ });
    await kuld(WIDGET_MEZO, TITOK);
    expect(await screen.findByText(VALASZ)).toBeInTheDocument();

    kilep();
    belep(B);
    nyitWidget();
    expect(
      screen.queryByText(TITOK),
      'A B fiók widgetje megmutatta az A fiók AI-beszélgetését — a kijelentkezés '
      + 'után a globális kulcsba írt, majd „migrált" előzmény szivárgott át.',
    ).toBeNull();
    expect(screen.queryByText(VALASZ)).toBeNull();
    expect(tarolt(), 'Az A fiók beszélgetése a kijelentkezés után is a böngészőben maradt.')
      .not.toContain('Anna');
  });

  it('A késve érkező AI-válasza nem kerül a közben belépett B fiókhoz', async () => {
    belep(A);
    render(<AiChatWidget />);
    nyitWidget();
    let valaszol: (v: { reply: string }) => void = () => {};
    ai.chat.mockReturnValueOnce(new Promise((r) => { valaszol = r; }));
    await kuld(WIDGET_MEZO, TITOK);

    kilep();
    belep(B);
    await act(async () => { valaszol({ reply: VALASZ }); });
    nyitWidget();
    expect(
      screen.queryByText(VALASZ),
      'Az A fiók kérdésére érkező válasz a B fiók beszélgetésében jelent meg.',
    ).toBeNull();
    expect(localStorage.getItem(kulcs(B.id)) ?? '').not.toContain('Anna');
  });
});

describe('A teljes oldalas AI segéd is fiókhoz kötött (R1-7)', () => {
  it('A oldalon folytatott beszélgetése B-nek sem újratöltés nélkül, sem újratöltés után nem látszik', async () => {
    belep(A);
    const nezet = render(<AiChatPage />);
    ai.chat.mockResolvedValueOnce({ reply: VALASZ });
    await kuld(OLDAL_MEZO, TITOK);
    expect(await screen.findByText(VALASZ)).toBeInTheDocument();

    kilep();
    belep(B);
    expect(
      screen.queryByText(TITOK),
      'Az AI-oldal a fiókváltás után is az A fiók beszélgetését mutatta.',
    ).toBeNull();

    // „Újratöltés": friss mount a B fiókkal.
    nezet.unmount();
    render(<AiChatPage />);
    expect(
      screen.queryByText(TITOK),
      'Újratöltés után a B fiók az A fiók globális kulcsban hagyott beszélgetését kapta.',
    ).toBeNull();
    expect(tarolt()).not.toContain('Anna');
  });

  it('az oldal és a widget UGYANAZT a fiókhoz kötött előzményt használja, és az a fióknál megmarad', async () => {
    belep(A);
    const nezet = render(<><AiChatPage /><AiChatWidget /></>);
    ai.chat.mockResolvedValueOnce({ reply: VALASZ });
    await kuld(OLDAL_MEZO, TITOK);
    await screen.findByText(VALASZ);
    nyitWidget();
    expect(
      screen.getAllByText(TITOK),
      'Az oldalon folytatott beszélgetés nem jelent meg a widgetben — a kettő külön kulcsot használt.',
    ).toHaveLength(2);

    // Ugyanaz a fiók „újratöltés" után visszakapja a saját beszélgetését.
    nezet.unmount();
    render(<AiChatPage />);
    expect(screen.getByText(TITOK)).toBeInTheDocument();
    expect(localStorage.getItem(kulcs(A.id)) ?? '').toContain(TITOK);
  });
});

describe('A régi, fiókfüggetlen kulcs soha nem kerül át (R1-7)', () => {
  it('a globális kulcs tartalmát sem a widget, sem az oldal nem veszi át, és törlődik', () => {
    localStorage.setItem(REGI_KULCS, JSON.stringify([{ role: 'user', content: TITOK }]));
    belep(B);
    render(<><AiChatPage /><AiChatWidget /></>);
    nyitWidget();
    expect(
      screen.queryAllByText(TITOK),
      'Egy korábbi (ismeretlen) fiók globális kulcsban maradt beszélgetése megjelent a B fióknál.',
    ).toHaveLength(0);
    expect(localStorage.getItem(kulcs(B.id)), 'A régi kulcsot a B fiók „örökölte".').toBeNull();
    expect(localStorage.getItem(REGI_KULCS), 'A régi, fiókfüggetlen kulcs bent maradt.').toBeNull();
  });

  it('kijelentkezés törli a kilépő fiók AI-előzményét és a régi globális kulcsot', () => {
    belep(A);
    localStorage.setItem(kulcs(A.id), JSON.stringify([{ role: 'user', content: TITOK }]));
    localStorage.setItem(REGI_KULCS, JSON.stringify([{ role: 'user', content: TITOK }]));
    kilep();
    expect(localStorage.getItem(kulcs(A.id)), 'A kilépő fiók AI-előzménye bent maradt.').toBeNull();
    expect(localStorage.getItem(REGI_KULCS), 'A régi globális kulcs bent maradt.').toBeNull();
  });
});

describe('Üzenethossz: 2000 karakteres plafon és barátságos hiba (R1-7)', () => {
  it.each([
    ['widget', WIDGET_MEZO, () => <AiChatWidget />],
    ['oldal', OLDAL_MEZO, () => <AiChatPage />],
  ])('%s: maxLength=2000, és az AI_MESSAGE_TOO_LONG magyar, érthető üzenetet ad', async (_nev, mezoNev, felulet) => {
    belep(A);
    render(felulet());
    nyitWidget();
    const mezo = screen.getByPlaceholderText(mezoNev);
    expect(mezo).toHaveAttribute('maxlength', '2000');

    ai.chat.mockRejectedValueOnce(Object.assign(new Error('Payload rejected'), {
      code: 'AI_MESSAGE_TOO_LONG', status: 400,
    }));
    await kuld(mezoNev, 'Hosszú kérdés');
    expect(await screen.findByText(/legfeljebb 2000 karakter/)).toBeInTheDocument();
    expect(screen.queryByText(/Payload rejected/), 'A nyers backend-hiba jelent meg a felhasználónak.')
      .toBeNull();
    // Az elutasított szöveg visszakerül a mezőbe, és nem mérgezi az előzményt.
    expect(screen.getByPlaceholderText(mezoNev)).toHaveValue('Hosszú kérdés');
    expect(localStorage.getItem(kulcs(A.id)) ?? '').not.toContain('Hosszú kérdés');
  });
});

describe('Forrás-őr: az AI-előzmény kulcsához csak a helperen át szabad nyúlni', () => {
  it("a nyers 'gofuvar_ai_history' kulcs csak a lib/aiHistory.ts-ben szerepelhet", () => {
    const gyoker = path.resolve(__dirname, '..', '..');
    const vetkesek: string[] = [];
    const bejar = (mappa: string) => {
      for (const b of fs.readdirSync(mappa, { withFileTypes: true })) {
        const ut = path.join(mappa, b.name);
        if (b.isDirectory()) {
          if (['node_modules', '.next', 'coverage', 'e2e'].includes(b.name)) continue;
          bejar(ut);
          continue;
        }
        if (!/\.(ts|tsx)$/.test(b.name) || /\.test\.tsx?$/.test(b.name)) continue;
        const rel = path.relative(gyoker, ut);
        if (rel === path.join('src', 'lib', 'aiHistory.ts')) continue;
        // Az adatkezelési tájékoztató táblázata dokumentálja a kulcsot.
        if (rel === path.join('app', 'adatkezeles', 'page.tsx')) continue;
        if (fs.readFileSync(ut, 'utf8').includes(REGI_KULCS)) vetkesek.push(rel);
      }
    };
    bejar(path.join(gyoker, 'src'));
    bejar(path.join(gyoker, 'app'));
    expect(
      vetkesek,
      `Közvetlen '${REGI_KULCS}' hozzáférés a helperen kívül: ${vetkesek.join(', ')} — `
      + 'használd a lib/aiHistory.ts-t, különben a fiókok közti AI-előzmény-szivárgás visszajöhet.',
    ).toEqual([]);
  });
});
