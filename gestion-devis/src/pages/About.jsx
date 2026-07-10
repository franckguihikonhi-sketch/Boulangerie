import { useI18n } from '../i18n/I18nContext';
import { Card, PageTitle } from '../components/ui';
import Logo from '../components/Logo';

// Page « À propos » : présentation de l'application et de ses bénéfices.
export default function About() {
  const { t } = useI18n();
  const benefits = ['b1', 'b2', 'b3', 'b4', 'b5', 'b6', 'b7', 'b8'];

  return (
    <div>
      <PageTitle>{t('about.title')}</PageTitle>

      <Card className="mb-5 overflow-hidden">
        <div className="flex items-center gap-4 border-b border-stone-100 bg-gradient-to-r from-brand-50 to-white p-5">
          <Logo size={56} rounded="rounded-2xl" className="shadow" />
          <div>
            <h2 className="text-xl font-bold text-stone-900">{t('app.name')}</h2>
            <p className="text-sm text-stone-600">{t('about.tagline')}</p>
          </div>
        </div>

        <div className="p-5">
          <h3 className="mb-3 text-sm font-semibold uppercase tracking-wide text-stone-500">
            {t('about.benefitsTitle')}
          </h3>
          <ul className="grid gap-x-6 gap-y-2.5 sm:grid-cols-2">
            {benefits.map((b) => (
              <li key={b} className="flex items-start gap-2.5 text-sm text-stone-700">
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2"
                  strokeLinecap="round" strokeLinejoin="round" className="mt-0.5 flex-none text-brand-600">
                  <path d="M20 6L9 17l-5-5" />
                </svg>
                <span>{t(`about.${b}`)}</span>
              </li>
            ))}
          </ul>
        </div>
      </Card>

      <Card className="p-5 sm:p-6">
        <h3 className="mb-4 text-sm font-semibold uppercase tracking-wide text-stone-500">
          {t('about.designer')}
        </h3>
        <div className="flex flex-col items-center gap-5 sm:flex-row sm:items-start">
          <div className="flex h-24 w-24 flex-none items-center justify-center rounded-2xl bg-brand-100 text-2xl font-bold text-brand-700 ring-1 ring-stone-200">
            FK
          </div>
          <div className="text-center sm:text-left">
            <p className="text-lg font-bold text-stone-900">Mr Franck G. KONHI</p>
            <ul className="mt-2 space-y-1 text-sm text-stone-600">
              <li>{t('about.role2')}</li>
              <li>{t('about.role3')}</li>
            </ul>
            <p className="mt-3 text-sm font-medium text-stone-800">{t('about.phone')} : 07 78 08 44 06</p>
          </div>
        </div>
      </Card>

      <p className="mt-5 text-center text-xs text-stone-400">
        © {new Date().getFullYear()} Fish-Afric — Mr Franck G. KONHI. {t('about.rights')}
      </p>
    </div>
  );
}
