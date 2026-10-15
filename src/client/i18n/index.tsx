/** Lightweight i18n: typed keys, English source with per-locale dictionaries + fallback. */

import { createContext, useContext, useMemo, useState, useCallback, type ReactNode } from 'react';
import { LOCALES, type Locale } from '../../shared/contracts';
import { en } from './en';
import { nl } from './nl';
import { fr } from './fr';
import { de } from './de';

export type Dictionary = typeof en;
export type TranslationKey = keyof Dictionary;

const DICTS: Record<Locale, Partial<Record<keyof Dictionary, string>>> = { en, nl, fr, de };

type I18nValue = {
  locale: Locale;
  setLocale: (l: Locale) => void;
  t: (key: TranslationKey, params?: Record<string, string | number>) => string;
  formatNumber: (n: number, opts?: Intl.NumberFormatOptions) => string;
  formatDate: (iso: string) => string;
  formatTime: (iso: string) => string;
  fallbackActive: boolean;
};

const I18nContext = createContext<I18nValue | null>(null);

const STORAGE_KEY = 'tg_locale';

function detectLocale(): Locale {
  const stored = typeof localStorage !== 'undefined' ? localStorage.getItem(STORAGE_KEY) : null;
  if (stored && (LOCALES as readonly string[]).includes(stored)) return stored as Locale;
  const nav = typeof navigator !== 'undefined' ? navigator.language.slice(0, 2) : 'en';
  if ((LOCALES as readonly string[]).includes(nav)) return nav as Locale;
  return 'en';
}

export function I18nProvider({ children }: { children: ReactNode }) {
  const [locale, setLocaleState] = useState<Locale>(detectLocale);

  const setLocale = useCallback((l: Locale) => {
    setLocaleState(l);
    try {
      localStorage.setItem(STORAGE_KEY, l);
    } catch {
      // private mode: fall back to in-memory locale only
    }
    document.documentElement.lang = l;
  }, []);

  const value = useMemo<I18nValue>(() => {
    const dict = DICTS[locale] ?? en;
    const fallbackActive = locale !== 'en';
    const t = (key: TranslationKey, params?: Record<string, string | number>): string => {
      // English is always the source of truth; missing translations fall back clearly.
      const raw =
        (dict[key] as string | undefined) ?? (en[key] as string | undefined) ?? String(key);
      if (!params) return raw;
      return raw.replace(/\{(\w+)\}/g, (_m, name) => String(params[name] ?? `{${name}}`));
    };
    const numberLocale =
      locale === 'nl' ? 'nl-NL' : locale === 'fr' ? 'fr-FR' : locale === 'de' ? 'de-DE' : 'en-GB';
    return {
      locale,
      setLocale,
      t,
      // Locale changes display formatting ONLY — stored numeric meaning never changes.
      formatNumber: (n, opts) => new Intl.NumberFormat(numberLocale, opts).format(n),
      formatDate: (iso) => {
        const d = new Date(iso.length === 10 ? `${iso}T00:00:00Z` : iso);
        return new Intl.DateTimeFormat(numberLocale, {
          year: 'numeric',
          month: 'short',
          day: 'numeric',
          timeZone: 'UTC',
        }).format(d);
      },
      formatTime: (iso) =>
        new Intl.DateTimeFormat(numberLocale, { hour: '2-digit', minute: '2-digit' }).format(
          new Date(iso),
        ),
      fallbackActive,
    };
  }, [locale, setLocale]);

  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}

export function useI18n(): I18nValue {
  const ctx = useContext(I18nContext);
  if (!ctx) throw new Error('useI18n must be used within I18nProvider');
  return ctx;
}
