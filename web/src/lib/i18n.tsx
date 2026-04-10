'use client';

// GoFuvar i18n rendszer — lightweight, dependency-mentes.
//
// Használat:
//   const { t, locale, setLocale } = useTranslation();
//   <p>{t('jobs.title')}</p>                    → "Elérhető fuvarok"
//   <p>{t('delivery.codeHint')}</p>             → "Add át ezt a 6 jegyű..."
//   <p>{t('profile.memberSince', { date: 'április' })}</p> → "Tag április óta"
//
// A nyelvi fájlokat a `locales/` mappából statikusan importáljuk
// (Next.js bundlerben tree-shake-elt), így nincs runtime fetch.
import { createContext, useCallback, useContext, useEffect, useState } from 'react';

// Statikus importok — minden nyelv bundled
import hu from '@/locales/hu.json';
import en from '@/locales/en.json';

const LOCALES: Record<string, Record<string, any>> = { hu, en };
export const SUPPORTED_LOCALES = [
  { code: 'hu', label: 'Magyar', flag: '🇭🇺' },
  { code: 'en', label: 'English', flag: '🇬🇧' },
  // Később bővíthető:
  // { code: 'de', label: 'Deutsch', flag: '🇩🇪' },
  // { code: 'fr', label: 'Français', flag: '🇫🇷' },
];

const STORAGE_KEY = 'gofuvar_locale';

type I18nContextType = {
  locale: string;
  setLocale: (locale: string) => void;
  t: (key: string, params?: Record<string, string | number>) => string;
};

const I18nContext = createContext<I18nContextType | null>(null);

/**
 * Pont-szeparált kulccsal navigál a nested JSON-ban.
 * pl. 'jobs.category.standard' → locales.hu.jobs.category.standard
 */
function resolve(obj: any, path: string): string | undefined {
  return path.split('.').reduce((acc, part) => acc?.[part], obj);
}

export function I18nProvider({ children }: { children: React.ReactNode }) {
  const [locale, setLocaleState] = useState('hu');

  // Betöltés localStorage-ból (vagy böngésző nyelv)
  useEffect(() => {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored && LOCALES[stored]) {
      setLocaleState(stored);
    } else {
      // Böngésző nyelv detektálás
      const browserLang = navigator.language?.split('-')[0];
      if (browserLang && LOCALES[browserLang]) {
        setLocaleState(browserLang);
      }
    }
  }, []);

  const setLocale = useCallback((newLocale: string) => {
    if (!LOCALES[newLocale]) return;
    setLocaleState(newLocale);
    localStorage.setItem(STORAGE_KEY, newLocale);
  }, []);

  const t = useCallback(
    (key: string, params?: Record<string, string | number>): string => {
      // Először a kiválasztott nyelven keresünk, fallback magyar
      let text = resolve(LOCALES[locale], key) ?? resolve(LOCALES.hu, key) ?? key;

      // Paraméter behelyettesítés: {date} → params.date
      if (params && typeof text === 'string') {
        for (const [k, v] of Object.entries(params)) {
          text = text.replace(new RegExp(`\\{\\{?${k}\\}?\\}`, 'g'), String(v));
        }
      }
      return typeof text === 'string' ? text : key;
    },
    [locale],
  );

  return (
    <I18nContext.Provider value={{ locale, setLocale, t }}>
      {children}
    </I18nContext.Provider>
  );
}

export function useTranslation() {
  const ctx = useContext(I18nContext);
  if (ctx) return ctx;
  // Fallback ha nincs provider (SSR / tesztek)
  return {
    locale: 'hu',
    setLocale: () => {},
    t: (key: string) => resolve(LOCALES.hu, key) ?? key,
  };
}

/**
 * Összeg + valuta formázás a locale szerint.
 * formatPrice(48000, 'HUF') → "48 000 Ft"
 * formatPrice(120, 'EUR')   → "€120"
 */
export function formatPrice(amount: number | null | undefined, currency = 'HUF'): string {
  if (amount == null) return '—';
  if (currency === 'EUR') {
    return `€${amount.toLocaleString('en-EU')}`;
  }
  return `${amount.toLocaleString('hu-HU')} Ft`;
}
