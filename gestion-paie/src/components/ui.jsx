import { useEffect } from 'react';
import { useI18n } from '../i18n/I18nContext';

export function Card({ children, className = '' }) {
  return (
    <div className={`rounded-xl border border-stone-200 bg-white shadow-sm ${className}`}>
      {children}
    </div>
  );
}

// Carte d'indicateur avec info-bulle méthodologique : chaque montant porte sa
// définition, jamais un chiffre nu.
export function StatCard({ label, value, tip, tone = 'default', sub }) {
  const tones = {
    default: 'text-stone-900',
    good: 'text-green-700',
    bad: 'text-red-700',
    brand: 'text-brand-700'
  };
  return (
    <Card className="p-4">
      <div className="flex items-start justify-between gap-2">
        <p className="text-xs font-medium uppercase tracking-wide text-stone-500">{label}</p>
        {tip && (
          <span
            className="inline-flex h-4 w-4 flex-none cursor-help select-none items-center justify-center rounded-full border border-stone-300 text-[10px] font-bold text-stone-400"
            title={tip}
            aria-label={tip}
          >
            i
          </span>
        )}
      </div>
      <p className={`mt-2 text-xl font-semibold sm:text-2xl ${tones[tone]}`}>{value}</p>
      {sub && <p className="mt-1 text-xs text-stone-500">{sub}</p>}
    </Card>
  );
}

export function Badge({ children, tone = 'neutral' }) {
  const tones = {
    neutral: 'bg-stone-100 text-stone-700',
    warning: 'bg-amber-100 text-amber-800',
    danger: 'bg-red-100 text-red-800',
    success: 'bg-green-100 text-green-800',
    brand: 'bg-brand-100 text-brand-800'
  };
  return (
    <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${tones[tone]}`}>
      {children}
    </span>
  );
}

export function Button({ children, variant = 'primary', className = '', ...props }) {
  const variants = {
    primary:
      'bg-brand-600 text-white hover:bg-brand-700 focus-visible:outline-brand-600 disabled:bg-stone-300',
    secondary:
      'bg-white text-stone-700 border border-stone-300 hover:bg-stone-50 focus-visible:outline-stone-400',
    danger: 'bg-white text-red-700 border border-red-200 hover:bg-red-50 focus-visible:outline-red-500'
  };
  return (
    <button
      className={`inline-flex items-center justify-center gap-1.5 rounded-lg px-3.5 py-2 text-sm font-medium transition focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 disabled:cursor-not-allowed ${variants[variant]} ${className}`}
      {...props}
    >
      {children}
    </button>
  );
}

// Navigation Précédent/Suivant réutilisable pour tout écran qui traite les
// salariés un par un (fiche « Modifier », gestion des congés, bulletin
// individuel, solde de tout compte…) : cohérence d'ergonomie garantie dans
// toute l'application, sans avoir à ouvrir/fermer/rechercher à chaque fois.
// `index` (0-based) et `total` portent sur la liste RÉELLEMENT affichée par
// l'écran appelant (déjà filtrée le cas échéant, ex. par la période « Base »).
export function EmployeeNav({ index, total, onPrev, onNext }) {
  const { t } = useI18n();
  if (!(total > 0)) return null;
  return (
    <div className="flex items-center justify-between rounded-lg border border-stone-200 bg-stone-50 px-3 py-2">
      <button
        type="button"
        onClick={onPrev}
        disabled={index <= 0}
        className="flex items-center gap-1 text-sm font-medium text-stone-700 hover:text-brand-700 disabled:cursor-not-allowed disabled:text-stone-300 disabled:hover:text-stone-300"
      >
        <svg width="14" height="14" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="2"><path d="M12 4l-6 6 6 6" strokeLinecap="round" strokeLinejoin="round" /></svg>
        {t('employees.navPrev')}
      </button>
      <span className="text-xs text-stone-500">{t('employees.navPosition', { n: index + 1, total })}</span>
      <button
        type="button"
        onClick={onNext}
        disabled={index >= total - 1}
        className="flex items-center gap-1 text-sm font-medium text-stone-700 hover:text-brand-700 disabled:cursor-not-allowed disabled:text-stone-300 disabled:hover:text-stone-300"
      >
        {t('employees.navNext')}
        <svg width="14" height="14" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="2"><path d="M8 4l6 6-6 6" strokeLinecap="round" strokeLinejoin="round" /></svg>
      </button>
    </div>
  );
}

export function Modal({ title, onClose, children, wide = false }) {
  useEffect(() => {
    const onKey = (e) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);
  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 p-0 sm:items-center sm:p-4">
      <div
        className={`max-h-[92vh] w-full overflow-y-auto rounded-t-2xl bg-white p-5 shadow-xl sm:rounded-2xl ${wide ? 'sm:max-w-3xl' : 'sm:max-w-md'}`}
        role="dialog"
        aria-modal="true"
      >
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-lg font-semibold text-stone-900">{title}</h2>
          <button
            onClick={onClose}
            className="rounded-full p-1.5 text-stone-400 hover:bg-stone-100 hover:text-stone-600"
            aria-label="Fermer"
          >
            <svg width="18" height="18" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M5 5l10 10M15 5L5 15" strokeLinecap="round" />
            </svg>
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}

export function Field({ label, help, children }) {
  return (
    <label className="block">
      <span className="mb-1 block text-sm font-medium text-stone-700">{label}</span>
      {children}
      {help && <span className="mt-1 block text-xs text-stone-500">{help}</span>}
    </label>
  );
}

export const inputClass =
  'w-full rounded-lg border border-stone-300 px-3 py-2 text-sm text-stone-900 placeholder-stone-400 focus:border-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-200';

export function ErrorNote({ children }) {
  if (!children) return null;
  return (
    <p className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800">
      {children}
    </p>
  );
}

export function InfoNote({ children }) {
  return (
    <p className="rounded-lg border border-stone-200 bg-stone-50 px-3 py-2 text-xs leading-relaxed text-stone-600">
      {children}
    </p>
  );
}

export function PageTitle({ children, actions }) {
  return (
    <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
      <h1 className="text-xl font-bold text-stone-900 sm:text-2xl">{children}</h1>
      {actions}
    </div>
  );
}

// Tableau responsive : défile horizontalement dans son conteneur sur mobile.
export function TableWrap({ children, min = 560 }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm" style={{ minWidth: `${min}px` }}>{children}</table>
    </div>
  );
}

export const th = 'px-3 py-2.5 text-left text-xs font-semibold uppercase tracking-wide text-stone-500';
export const td = 'px-3 py-2.5 text-stone-800';
