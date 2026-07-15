import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../lib/auth';
import { useI18n } from '../i18n/I18nContext';
import Logo from '../components/Logo';
import { Button, ErrorNote, Field, inputClass } from '../components/ui';

export default function Login() {
  const { login, startGuest } = useAuth();
  const { t, locale, setLocale } = useI18n();
  const navigate = useNavigate();
  const [email, setEmail] = useState('admin@paie.ci');
  const [password, setPassword] = useState('admin123');
  const [error, setError] = useState('');
  const [photoOk, setPhotoOk] = useState(true);

  const submit = (e) => {
    e.preventDefault();
    setError('');
    if (login(email, password)) navigate('/');
    else setError(t('login.error'));
  };

  const guest = () => {
    startGuest();
    navigate('/');
  };

  return (
    <div className="flex min-h-screen items-center justify-center bg-gradient-to-br from-brand-50 via-stone-50 to-brand-100 px-4 py-10">
      <div className="w-full max-w-md">
        <div className="mb-6 flex flex-col items-center gap-3 text-center">
          <Logo size={56} />
          <div>
            <h1 className="text-2xl font-bold text-stone-900">{t('app.name')}</h1>
            <p className="text-sm text-stone-500">{t('app.tagline')}</p>
          </div>
        </div>

        <div className="rounded-2xl border border-stone-200 bg-white p-6 shadow-sm">
          <h2 className="text-lg font-semibold text-stone-900">{t('login.title')}</h2>
          <p className="mb-4 mt-1 text-sm text-stone-500">{t('login.subtitle')}</p>
          <form onSubmit={submit} className="space-y-4">
            <Field label={t('login.email')}>
              <input className={inputClass} type="email" value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="username" />
            </Field>
            <Field label={t('login.password')}>
              <input className={inputClass} type="password" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="current-password" />
            </Field>
            <ErrorNote>{error}</ErrorNote>
            <Button type="submit" className="w-full">{t('login.submit')}</Button>
          </form>
          <div className="mt-4 border-t border-stone-100 pt-4">
            <Button variant="secondary" className="w-full" onClick={guest}>{t('login.guest')}</Button>
            <p className="mt-3 text-center text-xs text-stone-400">{t('login.demoHint')}</p>
          </div>
        </div>

        <div className="mt-5 flex justify-center gap-1 text-xs font-semibold">
          {['fr', 'en'].map((l) => (
            <button
              key={l}
              onClick={() => setLocale(l)}
              className={`rounded px-2 py-1 uppercase ${locale === l ? 'bg-brand-600 text-white' : 'text-stone-500 hover:bg-stone-100'}`}
            >
              {l}
            </button>
          ))}
        </div>

        {/* Concepteur */}
        <div className="mt-6 flex flex-col items-center gap-3 rounded-2xl border border-stone-200 bg-white/70 p-4 text-center shadow-sm">
          {photoOk ? (
            <img
              src="./concepteur.jpg"
              alt="Franck G. KONHI"
              onError={() => setPhotoOk(false)}
              className="h-16 w-16 rounded-xl object-cover shadow-md ring-1 ring-stone-200"
            />
          ) : (
            <div className="flex h-16 w-16 items-center justify-center rounded-xl bg-brand-100 text-lg font-bold text-brand-700 shadow-inner ring-1 ring-stone-200">
              FK
            </div>
          )}
          <div>
            <p className="text-sm font-bold text-stone-900">Mr Franck G. KONHI</p>
            <p className="mt-0.5 text-xs text-stone-500">Consultant paie et système de rémunération</p>
            <p className="text-xs text-stone-500">Développeur d'application de gestion</p>
          </div>
        </div>
      </div>
    </div>
  );
}
