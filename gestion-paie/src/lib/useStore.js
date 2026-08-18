import { useEffect } from 'react';
import { useSyncExternalStore } from 'react';
import { ensureHydrated, getState, getStatus, subscribe } from './db';
import { getActivePeriod, subscribeActivePeriod } from './period';

// Abonnement React au cache de données.
export function useStore() {
  return useSyncExternalStore(subscribe, getState);
}

// Période active « aaaa-mm » choisie via le bouton « Base » — voir period.js.
export function useActivePeriod() {
  return useSyncExternalStore(subscribeActivePeriod, getActivePeriod);
}

// État de connexion à la base (loading / ready / error) + hydratation initiale.
export function useDbStatus() {
  useEffect(() => {
    ensureHydrated();
  }, []);
  return useSyncExternalStore(subscribe, getStatus);
}
