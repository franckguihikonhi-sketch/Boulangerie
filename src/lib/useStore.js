import { useEffect, useSyncExternalStore } from 'react';
import { ensureHydrated, getState, getStatus, subscribe } from './db';

// Abonnement React au cache de données (hydraté depuis Supabase).
export function useStore() {
  return useSyncExternalStore(subscribe, getState);
}

// État de connexion à la base (loading / ready / error) + déclenchement de
// l'hydratation initiale.
export function useDbStatus() {
  useEffect(() => {
    ensureHydrated();
  }, []);
  return useSyncExternalStore(subscribe, getStatus);
}
