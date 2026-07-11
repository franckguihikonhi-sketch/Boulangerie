import { useDbStatus } from '../lib/useStore';
import { hydrate } from '../lib/db';
import { Button } from './ui';

// Attend l'hydratation avant d'afficher l'application. Affiche un chargement,
// ou une erreur claire (table non créée) avec la marche à suivre.
export default function DbGate({ children }) {
  const { status, error } = useDbStatus();

  if (status === 'ready') return children;

  if (status === 'error') {
    return (
      <div className="mx-auto max-w-lg py-16 text-center">
        <div className="rounded-2xl border border-amber-200 bg-amber-50 p-6">
          <p className="text-3xl">🗄️</p>
          <h2 className="mt-3 text-lg font-semibold text-stone-900">Base non prête</h2>
          <p className="mt-2 text-sm text-stone-600">{error}</p>
          <div className="mt-4 flex justify-center">
            <Button onClick={() => hydrate()}>Réessayer</Button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="flex min-h-[60vh] items-center justify-center">
      <div className="flex flex-col items-center gap-3 text-stone-500">
        <span className="h-8 w-8 animate-spin rounded-full border-2 border-brand-200 border-t-brand-600" />
        <p className="text-sm">Chargement…</p>
      </div>
    </div>
  );
}
