'use client';

// Világos / sötét téma kapcsoló (tesztelői kérés, 2026-08-04).
//
// Egyetlen gomb, ami körbelépteti a három állapotot:
//   Világos → Sötét → Rendszer → …
// A „Rendszer" azért kell, hogy aki eddig az OS-beállítását kapta, vissza
// tudjon állni rá — enélkül az első kattintás után örökre kézi vezérlés lenne.
//
// A logika a `src/lib/theme.ts`-ben él; ez a komponens csak megjeleníti.
import { useEffect, useState } from 'react';
import { Moon, Sun, Monitor } from 'lucide-react';
import {
  THEME_EVENT, THEME_LABELS, ThemeChoice,
  nextThemeChoice, prefersDark, readThemeChoice, resolveTheme, setThemeChoice,
} from '@/lib/theme';

const ICONS: Record<ThemeChoice, typeof Sun> = {
  light: Sun,
  dark: Moon,
  system: Monitor,
};

export default function ThemeToggle({ compact = false }: { compact?: boolean }) {
  // Szerveren és az első renderen NEM tudjuk a témát (localStorage) — ezért
  // csak mountolás után rajzoljuk ki, különben hidratálási eltérés lenne.
  const [mounted, setMounted] = useState(false);
  const [choice, setChoice] = useState<ThemeChoice>('system');

  useEffect(() => {
    setMounted(true);
    setChoice(readThemeChoice());
    const sync = () => setChoice(readThemeChoice());
    window.addEventListener(THEME_EVENT, sync);
    // másik tabon váltott téma
    window.addEventListener('storage', sync);
    return () => {
      window.removeEventListener(THEME_EVENT, sync);
      window.removeEventListener('storage', sync);
    };
  }, []);

  // „Rendszer" módban élőben követjük, ha a user az OS-ben vált témát.
  useEffect(() => {
    if (!mounted || choice !== 'system' || !window.matchMedia) return;
    const mq = window.matchMedia('(prefers-color-scheme: dark)');
    const onChange = () => setThemeChoice('system');
    mq.addEventListener('change', onChange);
    return () => mq.removeEventListener('change', onChange);
  }, [mounted, choice]);

  if (!mounted) {
    // Helyfoglaló: ne ugráljon a fejléc, amíg kiderül a téma
    return <span aria-hidden style={{ display: 'inline-block', width: compact ? 20 : 36, height: 36 }} />;
  }

  const Icon = ICONS[choice];
  const next = nextThemeChoice(choice);
  const resolved = resolveTheme(choice, prefersDark());
  const label = choice === 'system'
    ? `Téma: rendszer szerint (${resolved === 'dark' ? 'sötét' : 'világos'})`
    : `Téma: ${THEME_LABELS[choice].toLowerCase()}`;

  return (
    <button
      type="button"
      onClick={() => setThemeChoice(next)}
      title={`${label} — kattints a váltáshoz (${THEME_LABELS[next].toLowerCase()})`}
      aria-label={`${label}. Váltás erre: ${THEME_LABELS[next].toLowerCase()}`}
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 6,
        padding: compact ? '6px 8px' : '7px 10px',
        borderRadius: 999,
        border: '1px solid var(--border)',
        background: 'transparent',
        color: 'var(--text-secondary)',
        cursor: 'pointer',
        transition: 'all 0.15s',
        lineHeight: 1,
      }}
      onMouseEnter={(e) => (e.currentTarget.style.background = 'var(--surface-hover)')}
      onMouseLeave={(e) => (e.currentTarget.style.background = 'transparent')}
    >
      <Icon size={17} style={{ display: 'block' }} />
      {!compact && (
        <span style={{ fontSize: 12, fontWeight: 600 }}>{THEME_LABELS[choice]}</span>
      )}
    </button>
  );
}
