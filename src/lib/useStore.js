import { useSyncExternalStore } from 'react';
import { getState, subscribe } from './db';

// Abonnement React à la couche de données : chaque mutation notifie les
// composants, qui relisent l'état à jour (pas de cache intermédiaire —
// principe qui corrige l'anomalie n°2).
export function useStore() {
  return useSyncExternalStore(subscribe, getState);
}
