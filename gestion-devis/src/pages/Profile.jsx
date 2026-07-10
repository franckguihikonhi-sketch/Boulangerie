import { useNavigate } from 'react-router-dom';
import { useI18n } from '../i18n/I18nContext';
import { useAuth } from '../lib/auth';
import { Button, Card, InfoNote, PageTitle } from '../components/ui';

// Utilitaires : gestion du profil et déconnexion (section « Utilitaires » du
// cahier des charges).
export default function Profile() {
  const { t, locale, setLocale } = useI18n();
  const { user, isGuest, logout } = useAuth();
  const navigate = useNavigate();

  const handleLogout = () => {
    logout();
    navigate('/login', { replace: true });
  };

  const Row = ({ label, value }) => (
    <div className="flex items-center justify-between border-b border-stone-100 py-3 last:border-0">
      <span className="text-sm text-stone-500">{label}</span>
      <span className="text-sm font-medium text-stone-900">{value}</span>
    </div>
  );

  return (
    <div>
      <PageTitle>{t('profile.title')}</PageTitle>

      <Card className="mb-4 p-5">
        <div className="mb-2 flex items-center gap-3">
          <span className="flex h-12 w-12 items-center justify-center rounded-full bg-brand-100 text-lg font-bold text-brand-700">
            {(user.name || '?').charAt(0).toUpperCase()}
          </span>
          <div>
            <p className="text-base font-semibold text-stone-900">{user.name}</p>
            <p className="text-sm text-stone-500">{t(`role.${user.role}`)}</p>
          </div>
        </div>
        <Row label={t('profile.name')} value={user.name} />
        <Row label={t('profile.email')} value={user.email} />
        <Row label={t('profile.role')} value={t(`role.${user.role}`)} />
      </Card>

      <Card className="mb-4 p-5">
        <p className="mb-2 text-sm font-medium text-stone-700">{t('profile.language')}</p>
        <div className="flex overflow-hidden rounded-lg border border-stone-300 text-sm font-semibold">
          {['fr', 'en'].map((l) => (
            <button
              key={l}
              onClick={() => setLocale(l)}
              className={`px-4 py-2 uppercase ${locale === l ? 'bg-brand-600 text-white' : 'bg-white text-stone-600 hover:bg-stone-50'}`}
            >
              {l}
            </button>
          ))}
        </div>
      </Card>

      {isGuest && (
        <div className="mb-4">
          <InfoNote>{t('profile.guestNote')}</InfoNote>
        </div>
      )}

      <Button variant="danger" onClick={handleLogout} className="w-full sm:w-auto">
        {t('profile.logout')}
      </Button>
    </div>
  );
}
