import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import fr from './fr.json';
import en from './en.json';

// Interface bilingue FR / EN via fichiers statiques. Le contenu saisi par
// l'utilisateur (noms, primes) n'est jamais traduit automatiquement.
const DICTS = { fr, en };
const I18nContext = createContext(null);

export function I18nProvider({ children }) {
  const [locale, setLocale] = useState(() => localStorage.getItem('gpaie-locale') || 'fr');

  useEffect(() => {
    document.documentElement.setAttribute('lang', locale);
  }, [locale]);

  const t = useCallback(
    (key, vars) => {
      let str = DICTS[locale][key] ?? DICTS.fr[key] ?? key;
      if (vars) {
        for (const [k, v] of Object.entries(vars)) {
          str = str.replaceAll(`{${k}}`, String(v));
        }
      }
      return str;
    },
    [locale]
  );

  const value = useMemo(
    () => ({
      locale,
      t,
      setLocale: (l) => {
        localStorage.setItem('gpaie-locale', l);
        setLocale(l);
      }
    }),
    [locale, t]
  );

  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}

export function useI18n() {
  return useContext(I18nContext);
}
