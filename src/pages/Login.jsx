import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useI18n } from '../i18n/I18nContext';
import { useAuth } from '../lib/auth';
import { Button, ErrorNote, Field, inputClass } from '../components/ui';
import Logo from '../components/Logo';

export default function Login() {
  const { t, locale, setLocale } = useI18n();
  const { login, register, startGuest, user, isAdmin } = useAuth();
  const navigate = useNavigate();
  const [mode, setMode] = useState('login');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [name, setName] = useState('');
  const [error, setError] = useState('');
  const [demoExpired] = useState(() => {
    try {
      if (sessionStorage.getItem('boulange-demo-expired')) {
        sessionStorage.removeItem('boulange-demo-expired');
        return true;
      }
    } catch {
      /* ignore */
    }
    return false;
  });

  const goDemo = () => {
    startGuest();
    navigate('/', { replace: true });
  };

  if (user) {
    navigate(isAdmin ? '/' : '/ventes', { replace: true });
    return null;
  }

  const submit = (e) => {
    e.preventDefault();
    setError('');
    if (mode === 'register') {
      if (!register(name, email, password)) {
        setError(t('auth.emailTaken'));
        return;
      }
      if (login(email, password)) navigate('/ventes');
      return;
    }
    if (!login(email, password)) {
      setError(t('auth.invalid'));
      return;
    }
    navigate('/');
  };

  return (
    <div className="flex min-h-screen items-center justify-center bg-gradient-to-br from-brand-50 via-stone-50 to-brand-100 p-4">
      <div className="w-full max-w-sm">
        <div className="mb-6 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <Logo size={44} rounded="rounded-xl" className="shadow" />
            <div>
              <h1 className="text-lg font-bold text-stone-900">{t('app.name')}</h1>
              <p className="text-xs text-stone-500">{t('app.tagline')}</p>
            </div>
          </div>
          <div className="flex overflow-hidden rounded-lg border border-stone-300 text-xs font-semibold">
            {['fr', 'en', 'ar'].map((l) => (
              <button
                key={l}
                onClick={() => setLocale(l)}
                className={`px-2.5 py-1.5 uppercase ${locale === l ? 'bg-brand-600 text-white' : 'bg-white text-stone-600'}`}
              >
                {l}
              </button>
            ))}
          </div>
        </div>

        {demoExpired && (
          <div className="mb-4 rounded-xl border border-amber-200 bg-amber-50 p-3 text-center text-xs font-medium text-amber-800">
            {t('demo.expired')}
          </div>
        )}

        <form onSubmit={submit} className="space-y-4 rounded-2xl border border-stone-200 bg-white p-6 shadow-sm">
          <div>
            <h2 className="text-lg font-semibold text-stone-900">
              {mode === 'login' ? t('auth.title') : t('auth.createAccount')}
            </h2>
            <p className="text-sm text-stone-500">{t('auth.subtitle')}</p>
          </div>
          {mode === 'register' && (
            <Field label={t('auth.name')}>
              <input className={inputClass} value={name} onChange={(e) => setName(e.target.value)} required />
            </Field>
          )}
          <Field label={t('auth.email')}>
            <input
              type="email"
              className={inputClass}
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="admin@boulangerie.com"
              required
            />
          </Field>
          <Field label={t('auth.password')}>
            <input
              type="password"
              className={inputClass}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
            />
          </Field>
          <ErrorNote>{error}</ErrorNote>
          <Button type="submit" className="w-full">
            {mode === 'login' ? t('auth.login') : t('auth.register')}
          </Button>
          <button
            type="button"
            onClick={() => {
              setMode(mode === 'login' ? 'register' : 'login');
              setError('');
            }}
            className="block w-full text-center text-sm font-medium text-brand-700 hover:underline"
          >
            {mode === 'login' ? t('auth.createAccount') : t('auth.backToLogin')}
          </button>
        </form>

        {/* Accès invité : lance une démo isolée de 30 minutes, sans compte. */}
        <button
          type="button"
          onClick={goDemo}
          className="mt-4 flex w-full items-center justify-center gap-2 rounded-xl border-2 border-brand-600 bg-brand-50 px-4 py-3 text-sm font-semibold text-brand-800 transition hover:bg-brand-100"
        >
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"
            strokeLinecap="round" strokeLinejoin="round" className="flex-none">
            <path d="M5 3l14 9-14 9V3z" />
          </svg>
          {t('demo.guest')}
        </button>
        <p className="mt-1.5 text-center text-xs text-stone-500">{t('demo.subtitle')}</p>
      </div>
    </div>
  );
}
