import { useDbStatus } from '../lib/useStore';
import { useI18n } from '../i18n/I18nContext';

// Attend l'hydratation des données avant d'afficher les pages. La couche de
// données étant locale (localStorage), l'état passe immédiatement à « ready ».
export default function DbGate({ children }) {
  const { status } = useDbStatus();
  const { t } = useI18n();

  if (status === 'ready') return children;

  return (
    <div className="flex min-h-[60vh] items-center justify-center">
      <div className="flex flex-col items-center gap-3 text-stone-500">
        <span className="h-8 w-8 animate-spin rounded-full border-2 border-brand-200 border-t-brand-600" />
        <p className="text-sm">{t('db.loading')}</p>
      </div>
    </div>
  );
}
