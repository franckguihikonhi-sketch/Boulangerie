// ---------------------------------------------------------------------------
// Période active — navigation « Base » (bouton d'en-tête).
// ---------------------------------------------------------------------------
// Un petit store externe (même mécanisme que db.js) qui retient le mois
// « aaaa-mm » choisi par l'utilisateur dans le sélecteur « Base ». Toutes les
// pages qui affichent un mois par défaut (Tableau de bord, Bulletins, Livre
// de paie, Cotisations, Impôts) l'utilisent comme point de départ, au lieu du
// mois calendaire courant — permet de naviguer dans les mois/années de paie
// passés (ou futurs) sans avoir à re-sélectionner le mois sur chaque page.
// Persisté en local (préférence d'affichage, pas une donnée de paie).
// ---------------------------------------------------------------------------

import { safeGet, safeSet } from './storage';

const KEY = 'gpaie-active-period';

export function currentYm() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

function validYm(v) {
  return typeof v === 'string' && /^\d{4}-\d{2}$/.test(v);
}

let activeYm = (() => {
  const stored = safeGet(KEY);
  return validYm(stored) ? stored : currentYm();
})();

const listeners = new Set();

export function getActivePeriod() {
  return activeYm;
}

export function setActivePeriod(ym) {
  if (!validYm(ym) || ym === activeYm) return;
  activeYm = ym;
  safeSet(KEY, ym);
  listeners.forEach((l) => l());
}

export function subscribeActivePeriod(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}
