// Accès localStorage tolérant aux environnements restreints (navigation privée,
// iframe bac à sable, quota dépassé). Ne lève jamais : en cas d'échec, l'état
// reste en mémoire pour la session courante.

export function safeGet(key) {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

export function safeSet(key, value) {
  try {
    localStorage.setItem(key, value);
  } catch {
    /* ignore : lecture seule ou quota atteint */
  }
}

export function safeRemove(key) {
  try {
    localStorage.removeItem(key);
  } catch {
    /* ignore */
  }
}
