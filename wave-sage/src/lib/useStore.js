import { useEffect } from 'react';
import { useSyncExternalStore } from 'react';
import { hydrater, getState, getStatus, subscribe } from './db';

// Abonnement React au cache de données (paramètres, règles, mappings, imports).
export function useStore() {
  return useSyncExternalStore(subscribe, getState);
}

// État de connexion à la base (loading / ready / error) + hydratation initiale.
export function useDbStatus() {
  useEffect(() => {
    hydrater();
  }, []);
  return useSyncExternalStore(subscribe, getStatus);
}
