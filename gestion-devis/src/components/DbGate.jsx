import { useDbStatus } from '../lib/useStore';
import { hydrate } from '../lib/db';
import { useI18n } from '../i18n/I18nContext';
import { useNavigate } from 'react-router-dom';
import { Button } from './ui';

// Attend l'hydratation des données avant d'afficher les pages. Affiche un état
// de chargement, ou une erreur claire (base non configurée / tables non
// créées) avec la marche à suivre.
export default function DbGate({ children }) {
  const { status, error } = useDbStatus();
  const { t } = useI18n();
  const navigate = useNavigate();

  if (status === 'ready') return children;

  if (status === 'error') {
    const notReady = error === 'errors.dbNotReady';
    const notConfigured = error === 'errors.dbNotConfigured';
    const title = notConfigured ? t('db.notConfiguredTitle') : notReady ? t('db.notReadyTitle') : t('db.errorTitle');
    const help = notConfigured ? t('db.notConfiguredHelp') : notReady ? t('db.notReadyHelp') : error;
    return (
      <div className="mx-auto max-w-lg py-16 text-center">
        <div className="rounded-2xl border border-amber-200 bg-amber-50 p-6">
          <p className="text-3xl">🗄️</p>
          <h2 className="mt-3 text-lg font-semibold text-stone-900">{title}</h2>
          <p className="mt-2 text-sm text-stone-600">{help}</p>
          <div className="mt-4 flex justify-center gap-2">
            <Button onClick={() => hydrate()}>{t('db.retry')}</Button>
            {notConfigured && (
              <Button variant="secondary" onClick={() => navigate('/demo')}>{t('demo.guest')}</Button>
            )}
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="flex min-h-[60vh] items-center justify-center">
      <div className="flex flex-col items-center gap-3 text-stone-500">
        <span className="h-8 w-8 animate-spin rounded-full border-2 border-brand-200 border-t-brand-600" />
        <p className="text-sm">{t('db.loading')}</p>
      </div>
    </div>
  );
}
