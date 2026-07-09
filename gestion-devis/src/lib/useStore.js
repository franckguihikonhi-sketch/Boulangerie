import { useEffect, useSyncExternalStore } from 'react';
import { ensureHydrated, getState, getStatus, subscribe } from './db';

// Abonnement React au cache de données.
export function useStore() {
  return useSyncExternalStore(subscribe, getState);
}

// État de connexion à la base (loading / ready / error) + hydratation initiale.
export function useDbStatus() {
  useEffect(() => {
    ensureHydrated();
  }, []);
  return useSyncExternalStore(subscribe, getStatus);
}
