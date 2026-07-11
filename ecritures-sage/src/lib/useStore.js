import { useEffect, useSyncExternalStore } from 'react';
import { ensureHydrated, getEntries, getStatus, subscribe } from './db';

// Abonnement React au cache des écritures.
export function useEntries() {
  return useSyncExternalStore(subscribe, getEntries);
}

// État de chargement de la base + déclenchement de l'hydratation initiale.
export function useDbStatus() {
  useEffect(() => {
    ensureHydrated();
  }, []);
  return useSyncExternalStore(subscribe, getStatus);
}
