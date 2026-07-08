import { useEffect, useState } from 'react';
import { useI18n } from '../i18n/I18nContext';
import { useAuth } from '../lib/auth';
import { checkActivation, activateWithCode, isNative } from '../lib/activation';
import { Button, ErrorNote, Field, inputClass } from './ui';
import Logo from './Logo';

// Verrou par appareil : sur l'app Android, un utilisateur réel doit avoir
// activé ce téléphone avec un code valide. Le mode démo (invité) et le web ne
// sont jamais verrouillés.
export default function ActivationGate({ children }) {
  const { user } = useAuth();
  const { t } = useI18n();
  const [state, setState] = useState('loading'); // loading | ok | need_code
  const [code, setCode] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const bypass = !isNative() || !!user?.guest;

  useEffect(() => {
    let alive = true;
    if (bypass) {
      setState('ok');
      return undefined;
    }
    setState('loading');
    checkActivation().then((r) => {
      if (alive) setState(r === 'ok' ? 'ok' : 'need_code');
    });
    return () => {
      alive = false;
    };
  }, [bypass]);

  if (bypass || state === 'ok') return children;

  if (state === 'loading') {
    return (
      <div className="flex min-h-[60vh] items-center justify-center">
        <span className="h-8 w-8 animate-spin rounded-full border-2 border-brand-200 border-t-brand-600" />
      </div>
    );
  }

  const submit = async (e) => {
    e.preventDefault();
    setBusy(true);
    setError('');
    const r = await activateWithCode(code);
    setBusy(false);
    if (r.ok) {
      setState('ok');
      return;
    }
    setError(
      t(
        r.reason === 'autre_appareil'
          ? 'activation.errorOtherDevice'
          : r.reason === 'service'
            ? 'activation.errorService'
            : 'activation.errorInvalid'
      )
    );
  };

  return (
    <div className="flex min-h-screen items-center justify-center bg-gradient-to-br from-brand-50 via-stone-50 to-brand-100 p-4">
      <div className="w-full max-w-sm">
        <div className="mb-6 flex items-center gap-3">
          <Logo size={44} rounded="rounded-xl" className="shadow" />
          <div>
            <h1 className="text-lg font-bold text-stone-900">{t('app.name')}</h1>
            <p className="text-xs text-stone-500">{t('activation.title')}</p>
          </div>
        </div>

        <form onSubmit={submit} className="space-y-4 rounded-2xl border border-stone-200 bg-white p-6 shadow-sm">
          <div>
            <h2 className="text-lg font-semibold text-stone-900">{t('activation.title')}</h2>
            <p className="text-sm text-stone-500">{t('activation.subtitle')}</p>
          </div>
          <Field label={t('activation.codeLabel')}>
            <input
              className={inputClass}
              value={code}
              onChange={(e) => setCode(e.target.value)}
              placeholder="BOUL-2026-0001"
              autoCapitalize="characters"
              autoCorrect="off"
              required
            />
          </Field>
          <ErrorNote>{error}</ErrorNote>
          <Button type="submit" className="w-full" disabled={busy}>
            {busy ? t('activation.checking') : t('activation.activate')}
          </Button>
          <p className="text-center text-xs text-stone-400">{t('activation.note')}</p>
        </form>
      </div>
    </div>
  );
}
