export function Card({ children, className = '' }) {
  return (
    <div className={`rounded-xl border border-stone-200 bg-white shadow-sm ${className}`}>
      {children}
    </div>
  );
}

export function Button({ children, variant = 'primary', className = '', ...props }) {
  const variants = {
    primary: 'bg-brand-700 text-white hover:bg-brand-800 focus-visible:outline-brand-700 disabled:bg-stone-300',
    secondary: 'bg-white text-stone-700 border border-stone-300 hover:bg-stone-50 focus-visible:outline-stone-400 disabled:opacity-50',
    danger: 'bg-white text-red-700 border border-red-200 hover:bg-red-50 focus-visible:outline-red-500 disabled:opacity-50'
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

export function Badge({ children, tone = 'neutral' }) {
  const tones = {
    neutral: 'bg-stone-100 text-stone-700',
    warning: 'bg-amber-100 text-amber-800',
    success: 'bg-green-100 text-green-800'
  };
  return (
    <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${tones[tone]}`}>
      {children}
    </span>
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
    <p className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800">{children}</p>
  );
}

export function InfoNote({ children }) {
  return (
    <p className="rounded-lg border border-stone-200 bg-stone-50 px-3 py-2 text-xs leading-relaxed text-stone-600">
      {children}
    </p>
  );
}

export function TableWrap({ children }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[560px] text-sm">{children}</table>
    </div>
  );
}

export const th = 'px-3 py-2.5 text-left text-xs font-semibold uppercase tracking-wide text-stone-500';
export const td = 'px-3 py-2.5 text-stone-800';
