import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import fr from './fr.json';
import en from './en.json';
import ar from './ar.json';

// Interface trilingue FR/EN/AR via fichiers statiques : aucune traduction
// automatique du contenu saisi par l'utilisateur (section 9). L'arabe s'écrit
// de droite à gauche : la direction du document bascule automatiquement.
const DICTS = { fr, en, ar };
const RTL_LOCALES = ['ar'];
const I18nContext = createContext(null);

export function I18nProvider({ children }) {
  const [locale, setLocale] = useState(() => localStorage.getItem('boulange-locale') || 'fr');

  // Applique la langue et le sens de lecture au document (html lang/dir) :
  // « rtl » pour l'arabe, « ltr » pour le français et l'anglais.
  useEffect(() => {
    const dir = RTL_LOCALES.includes(locale) ? 'rtl' : 'ltr';
    document.documentElement.setAttribute('lang', locale);
    document.documentElement.setAttribute('dir', dir);
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
        localStorage.setItem('boulange-locale', l);
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
