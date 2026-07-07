import { useState } from 'react';
import { useI18n } from '../i18n/I18nContext';
import { Card, PageTitle } from '../components/ui';

// Page « À propos » : présentation du logiciel, bienfaits, et informations
// sur le concepteur. La photo se charge depuis /concepteur.jpg (dossier
// public) ; si le fichier est absent, un joli médaillon aux initiales
// s'affiche à la place.
export default function About() {
  const { t } = useI18n();
  const [photoOk, setPhotoOk] = useState(true);

  const benefits = ['b1', 'b2', 'b3', 'b4', 'b5', 'b6', 'b7', 'b8', 'b9', 'b10'];

  return (
    <div>
      <PageTitle>{t('about.title')}</PageTitle>

      {/* Présentation du logiciel */}
      <Card className="mb-5 overflow-hidden">
        <div className="flex items-center gap-4 border-b border-stone-100 bg-gradient-to-r from-brand-50 to-white p-5">
          <span className="flex h-14 w-14 flex-none items-center justify-center rounded-2xl bg-brand-600 text-3xl shadow">🥖</span>
          <div>
            <h2 className="text-xl font-bold text-stone-900">Boulangerie ERP</h2>
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

      {/* Concepteur */}
      <Card className="p-5 sm:p-6">
        <h3 className="mb-4 text-sm font-semibold uppercase tracking-wide text-stone-500">
          {t('about.designer')}
        </h3>
        <div className="flex flex-col items-center gap-5 sm:flex-row sm:items-start">
          <div className="flex-none">
            {photoOk ? (
              <img
                src="./concepteur.jpg"
                alt="Franck G. KONHI"
                onError={() => setPhotoOk(false)}
                className="h-32 w-32 rounded-2xl object-cover shadow-md ring-1 ring-stone-200"
              />
            ) : (
              <div className="flex h-32 w-32 items-center justify-center rounded-2xl bg-brand-100 text-3xl font-bold text-brand-700 shadow-inner ring-1 ring-stone-200">
                FK
              </div>
            )}
          </div>

          <div className="text-center sm:text-left">
            <p className="text-lg font-bold text-stone-900">Mr Franck G. KONHI</p>
            <ul className="mt-2 space-y-1 text-sm text-stone-600">
              <li>{t('about.role1')}</li>
              <li>{t('about.role2')}</li>
              <li>{t('about.role3')}</li>
            </ul>
            <p className="mt-3 flex items-center justify-center gap-2 text-sm font-medium text-stone-800 sm:justify-start">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"
                strokeLinecap="round" strokeLinejoin="round" className="text-brand-600">
                <path d="M22 16.92v3a2 2 0 01-2.18 2 19.79 19.79 0 01-8.63-3.07 19.5 19.5 0 01-6-6 19.79 19.79 0 01-3.07-8.67A2 2 0 014.11 2h3a2 2 0 012 1.72c.13.96.36 1.9.7 2.81a2 2 0 01-.45 2.11L8.09 9.91a16 16 0 006 6l1.27-1.27a2 2 0 012.11-.45c.9.34 1.85.57 2.81.7A2 2 0 0122 16.92z" />
              </svg>
              {t('about.phone')} : 07 78 08 44 06
            </p>
          </div>
        </div>
      </Card>

      <p className="mt-5 text-center text-xs text-stone-400">
        © {new Date().getFullYear()} Boulangerie ERP — Mr Franck G. KONHI. {t('about.rights')}
      </p>
    </div>
  );
}
