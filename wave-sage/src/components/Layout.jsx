import { Badge } from './ui';

const NAV = [
  { id: 'import', label: 'Import', icone: '📥' },
  { id: 'historique', label: 'Historique', icone: '🗂️' },
  { id: 'regles', label: 'Règles', icone: '🧭' },
  { id: 'plan', label: 'Plan comptable', icone: '📚' },
  { id: 'parametres', label: 'Paramètres', icone: '⚙️' },
  { id: 'apropos', label: 'À propos', icone: 'ℹ️' }
];

export default function Layout({ page, setPage, backend, children }) {
  return (
    <div className="min-h-screen bg-stone-50 text-stone-800">
      <header className="border-b border-stone-200 bg-white">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-3 px-4 py-3">
          <div className="flex items-center gap-3">
            <span className="text-2xl">🌊</span>
            <div>
              <h1 className="text-lg font-bold leading-tight text-stone-900">
                Wave <span className="text-brand-700">→</span> SAGE
              </h1>
              <p className="text-xs text-stone-500">Import comptable · SYSCOHADA révisé</p>
            </div>
          </div>
          <Badge tone={backend === 'supabase' ? 'success' : 'neutral'}>
            {backend === 'supabase' ? 'Base dédiée connectée' : 'Mode local (navigateur)'}
          </Badge>
        </div>
        <nav className="mx-auto flex max-w-6xl gap-1 overflow-x-auto px-2 pb-2">
          {NAV.map((n) => (
            <button
              key={n.id}
              onClick={() => setPage(n.id)}
              className={`flex items-center gap-2 whitespace-nowrap rounded-lg px-3 py-2 text-sm font-medium transition ${
                page === n.id ? 'bg-brand-700 text-white' : 'text-stone-600 hover:bg-stone-100'
              }`}
            >
              <span aria-hidden>{n.icone}</span>
              {n.label}
            </button>
          ))}
        </nav>
      </header>
      <main className="mx-auto max-w-6xl px-4 py-6">{children}</main>
      <footer className="mx-auto max-w-6xl px-4 py-8 text-center text-xs text-stone-400">
        Wave → SAGE · Base de données dédiée, indépendante des autres applications du dépôt.
      </footer>
    </div>
  );
}
