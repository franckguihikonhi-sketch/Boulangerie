// Primitives d'interface partagées (boutons, cartes, champs, tableaux, badges).
// Style Tailwind sobre, palette « brand » indigo propre à cette application.

export function Button({ variant = 'primary', className = '', ...props }) {
  const base =
    'inline-flex items-center justify-center gap-2 rounded-lg px-4 py-2 text-sm font-semibold transition disabled:opacity-50 disabled:cursor-not-allowed';
  const variants = {
    primary: 'bg-brand-700 text-white hover:bg-brand-800 shadow-sm',
    secondary: 'border border-stone-300 bg-white text-stone-700 hover:bg-stone-50',
    ghost: 'text-brand-700 hover:bg-brand-50',
    danger: 'border border-red-300 bg-white text-red-700 hover:bg-red-50'
  };
  return <button className={`${base} ${variants[variant]} ${className}`} {...props} />;
}

export function Card({ title, subtitle, actions, children, className = '' }) {
  return (
    <section className={`rounded-2xl border border-stone-200 bg-white shadow-sm ${className}`}>
      {(title || actions) && (
        <header className="flex flex-wrap items-center justify-between gap-3 border-b border-stone-100 px-5 py-4">
          <div>
            {title && <h2 className="text-base font-semibold text-stone-800">{title}</h2>}
            {subtitle && <p className="mt-0.5 text-sm text-stone-500">{subtitle}</p>}
          </div>
          {actions && <div className="flex items-center gap-2">{actions}</div>}
        </header>
      )}
      <div className="p-5">{children}</div>
    </section>
  );
}

export function Field({ label, hint, children }) {
  return (
    <label className="block">
      <span className="mb-1 block text-xs font-medium uppercase tracking-wide text-stone-500">{label}</span>
      {children}
      {hint && <span className="mt-1 block text-xs text-stone-400">{hint}</span>}
    </label>
  );
}

export const inputClass =
  'w-full rounded-lg border border-stone-300 bg-white px-3 py-2 text-sm text-stone-800 outline-none focus:border-brand-500 focus:ring-2 focus:ring-brand-100';

export function Badge({ tone = 'neutral', children }) {
  const tones = {
    neutral: 'bg-stone-100 text-stone-600',
    brand: 'bg-brand-100 text-brand-800',
    success: 'bg-emerald-100 text-emerald-700',
    warn: 'bg-amber-100 text-amber-800',
    danger: 'bg-red-100 text-red-700',
    info: 'bg-sky-100 text-sky-700'
  };
  return (
    <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${tones[tone]}`}>
      {children}
    </span>
  );
}

export function TableWrap({ children }) {
  return <div className="overflow-x-auto">{children}</div>;
}

export const th = 'whitespace-nowrap px-3 py-2 text-left text-xs font-semibold uppercase tracking-wide text-stone-500';
export const td = 'whitespace-nowrap px-3 py-2 text-sm text-stone-700';

export function InfoNote({ children, tone = 'info' }) {
  const tones = {
    info: 'border-sky-200 bg-sky-50 text-sky-800',
    warn: 'border-amber-200 bg-amber-50 text-amber-800',
    success: 'border-emerald-200 bg-emerald-50 text-emerald-800'
  };
  return <div className={`rounded-lg border px-4 py-3 text-sm ${tones[tone]}`}>{children}</div>;
}

export function ErrorNote({ children }) {
  if (!children) return null;
  return <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{children}</div>;
}
