import { useState } from 'react';
import { NavLink, Outlet, useNavigate } from 'react-router-dom';
import { useI18n } from '../i18n/I18nContext';
import { useAuth } from '../lib/auth';
import { useActivePeriod, useStore } from '../lib/useStore';
import { setActivePeriod } from '../lib/period';
import { libelleMois } from '../lib/payroll';
import { Modal } from './ui';
import DbGate from './DbGate';
import Logo from './Logo';
import DemoCountdown from './DemoCountdown';

const NAV_ITEMS = [
  { to: '/', key: 'nav.dashboard', icon: 'M3 12l9-8 9 8M5 10v10h5v-6h4v6h5V10' },
  { to: '/salaries', key: 'nav.employees', icon: 'M12 12a4 4 0 100-8 4 4 0 000 8zm-7 8a7 7 0 0114 0' },
  { to: '/bulletins', key: 'nav.bulletins', icon: 'M7 3h7l5 5v13H5V5a2 2 0 012-2zm7 0v5h5M8 13h8M8 17h5' },
  { to: '/livre-de-paie', key: 'nav.livrePaie', icon: 'M4 5a2 2 0 012-2h9l5 5v11a2 2 0 01-2 2H6a2 2 0 01-2-2V5zM15 3v5h5M8 11h8M8 15h8M8 19h5' },
  { to: '/conges', key: 'nav.conges', icon: 'M8 7V3m8 4V3M4 11h16M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2zM8 15l2 2 4-4' },
  { to: '/etat-cotisations', key: 'nav.cotisations', icon: 'M12 2a10 10 0 100 20 10 10 0 000-20zM12 6v6l4 2' },
  { to: '/etat-impots', key: 'nav.impots', icon: 'M12 3v18M7 21h10M4 7h2c2 0 5-1 7-2 2 1 5 2 7 2h2M5 7l-3 8c1.7 1.3 4.3 1.3 6 0L5 7zM19 7l-3 8c1.7 1.3 4.3 1.3 6 0L19 7z' },
  { to: '/simulateur', key: 'nav.simulateur', icon: 'M5 3h14a2 2 0 012 2v14a2 2 0 01-2 2H5a2 2 0 01-2-2V5a2 2 0 012-2zM7 7h10M8 12h.01M12 12h.01M16 12h.01M8 16h.01M12 16h.01M16 16h.01' },
  { to: '/solde-tout-compte', key: 'nav.solde', icon: 'M9 5H6a2 2 0 00-2 2v12a2 2 0 002 2h12a2 2 0 002-2v-6M18 2l4 4-9 9H9v-4l9-9z' },
  { to: '/historique', key: 'nav.historique', icon: 'M12 8v4l3 3m6-3a9 9 0 11-9-9 9 9 0 019 9zM3 12a9 9 0 019-9' },
  { to: '/parametres', key: 'nav.settings', icon: 'M12 15a3 3 0 100-6 3 3 0 000 6zM19 12a7 7 0 00-.1-1l2-1.6-2-3.4-2.4 1a7 7 0 00-1.7-1L14.5 2h-5l-.3 2.9a7 7 0 00-1.7 1l-2.4-1-2 3.4L3.1 11a7 7 0 000 2l-2 1.6 2 3.4 2.4-1a7 7 0 001.7 1l.3 2.9h5l.3-2.9a7 7 0 001.7-1l2.4 1 2-3.4-2-1.6a7 7 0 00.1-1z' },
  { to: '/a-propos', key: 'nav.about', icon: 'M12 22c5.523 0 10-4.477 10-10S17.523 2 12 2 2 6.477 2 12s4.477 10 10 10zM12 16v-4M12 8h.01' }
];

function NavList({ onNavigate }) {
  const { t } = useI18n();
  return (
    <nav className="flex flex-col gap-0.5 px-2">
      {NAV_ITEMS.map((item) => (
        <NavLink
          key={item.to}
          to={item.to}
          end={item.to === '/'}
          onClick={onNavigate}
          className={({ isActive }) =>
            `flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium transition ${
              isActive ? 'bg-brand-100 text-brand-900' : 'text-stone-600 hover:bg-stone-100 hover:text-stone-900'
            }`
          }
        >
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"
            strokeLinecap="round" strokeLinejoin="round" className="flex-none">
            <path d={item.icon} />
          </svg>
          {t(item.key)}
        </NavLink>
      ))}
    </nav>
  );
}

function Brand() {
  const { t } = useI18n();
  return (
    <div className="flex items-center gap-2.5 px-4 py-4">
      <Logo size={40} />
      <div>
        <p className="text-sm font-bold text-stone-900">{t('app.name')}</p>
        <p className="text-[11px] text-stone-500">{t('app.tagline')}</p>
      </div>
    </div>
  );
}

const MOIS_ABREGES = {
  fr: ['Jan', 'Fév', 'Mar', 'Avr', 'Mai', 'Jun', 'Jul', 'Aoû', 'Sep', 'Oct', 'Nov', 'Déc'],
  en: ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
};

// Sélecteur « Base » : navigue par année puis par mois. Une fois un mois
// choisi, il devient la période active de toute l'app (voir lib/period.js) —
// Tableau de bord, Bulletins, Livre de paie, Cotisations et Impôts s'ouvrent
// désormais sur ce mois-là par défaut, au lieu du mois calendaire courant.
function BaseButton() {
  const { t, locale } = useI18n();
  const activeYm = useActivePeriod();
  const { clotures } = useStore();
  const estCloture = !!clotures?.[activeYm];
  const [open, setOpen] = useState(false);
  const [year, setYear] = useState(() => Number(activeYm.slice(0, 4)));

  const openPicker = () => {
    setYear(Number(activeYm.slice(0, 4)));
    setOpen(true);
  };

  const pick = (month) => {
    setActivePeriod(`${year}-${String(month).padStart(2, '0')}`);
    setOpen(false);
  };

  const [activeYear, activeMonth] = activeYm.split('-').map(Number);
  const months = MOIS_ABREGES[locale] || MOIS_ABREGES.fr;

  return (
    <>
      <button
        onClick={openPicker}
        className="flex flex-none items-center gap-1.5 rounded-lg border border-stone-300 bg-white px-2 py-1.5 text-xs font-semibold text-stone-700 hover:bg-stone-50 sm:px-2.5"
        title={t('base.help')}
      >
        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" className="flex-none">
          <path d="M4 5a2 2 0 012-2h9l5 5v11a2 2 0 01-2 2H6a2 2 0 01-2-2V5zM15 3v5h5M8 12h8M8 16h5" />
        </svg>
        {/* Le libellé « Base » reste toujours visible (jamais masqué en CSS) :
            sans lui, ce bouton ressemble à un simple badge de date, pas à un
            contrôle cliquable — c'est ce qui le rendait introuvable sur
            mobile. Seule la date affichée à côté se raccourcit. */}
        <span>{t('base.button')}</span>
        <span className="hidden capitalize sm:inline">· {libelleMois(activeYm, locale)}</span>
        {estCloture && (
          <span className="flex-none rounded-full bg-green-100 px-1.5 py-0.5 text-[10px] font-semibold uppercase text-green-800">
            {t('livrePaie.clotureBadge')}
          </span>
        )}
      </button>

      {open && (
        <Modal title={t('base.title')} onClose={() => setOpen(false)}>
          <p className="mb-3 text-sm text-stone-600">{t('base.help')}</p>
          <div className="mb-3 flex items-center justify-center gap-4">
            <button type="button" className="rounded-lg p-1.5 text-stone-500 hover:bg-stone-100" onClick={() => setYear((y) => y - 1)} aria-label="—">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M15 5l-7 7 7 7" /></svg>
            </button>
            <span className="text-lg font-semibold text-stone-800">{year}</span>
            <button type="button" className="rounded-lg p-1.5 text-stone-500 hover:bg-stone-100" onClick={() => setYear((y) => y + 1)} aria-label="+">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M9 5l7 7-7 7" /></svg>
            </button>
          </div>
          <div className="grid grid-cols-4 gap-2">
            {months.map((label, idx) => {
              const m = idx + 1;
              const isActive = year === activeYear && m === activeMonth;
              const ymBouton = `${year}-${String(m).padStart(2, '0')}`;
              const isCloture = !!clotures?.[ymBouton];
              return (
                <button
                  key={m}
                  type="button"
                  onClick={() => pick(m)}
                  title={isCloture ? t('livrePaie.clotureBadge') : undefined}
                  className={`relative rounded-lg border px-2 py-2.5 text-sm font-medium transition ${
                    isActive
                      ? 'border-brand-600 bg-brand-600 text-white'
                      : 'border-stone-200 text-stone-700 hover:border-brand-300 hover:bg-brand-50'
                  }`}
                >
                  {isCloture && (
                    <span className={`absolute right-1 top-1 h-1.5 w-1.5 rounded-full ${isActive ? 'bg-white' : 'bg-green-500'}`} />
                  )}
                  {label}
                </button>
              );
            })}
          </div>
        </Modal>
      )}
    </>
  );
}

export default function Layout() {
  const { t, locale, setLocale } = useI18n();
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  const [menuOpen, setMenuOpen] = useState(false);

  const handleLogout = () => {
    logout();
    navigate('/login');
  };

  return (
    <div className="min-h-screen bg-stone-50">
      <aside className="fixed inset-y-0 left-0 z-30 hidden w-60 flex-col border-r border-stone-200 bg-white lg:flex">
        <Brand />
        <div className="flex-1 overflow-y-auto py-2">
          <NavList />
        </div>
        <div className="border-t border-stone-200 p-3 text-xs text-stone-500">
          <p className="font-medium text-stone-700">{user?.name}</p>
          <p>{t(`role.${user?.role}`)}</p>
        </div>
      </aside>

      <header className="sticky top-0 z-20 flex h-14 items-center justify-between border-b border-stone-200 bg-white px-3 sm:px-5 lg:pl-64">
        <div className="flex items-center gap-2">
          <button
            className="rounded-lg p-2 text-stone-600 hover:bg-stone-100 lg:hidden"
            onClick={() => setMenuOpen(true)}
            aria-label="Menu"
          >
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
              <path d="M4 6h16M4 12h16M4 18h16" />
            </svg>
          </button>
          <span className="text-sm font-semibold text-stone-800 lg:hidden">{t('app.name')}</span>
        </div>
        <div className="flex items-center gap-2">
          <BaseButton />
          <DemoCountdown />
          <div className="flex overflow-hidden rounded-lg border border-stone-300 text-xs font-semibold">
            {['fr', 'en'].map((l) => (
              <button
                key={l}
                onClick={() => setLocale(l)}
                className={`px-2.5 py-1.5 uppercase ${locale === l ? 'bg-brand-600 text-white' : 'bg-white text-stone-600 hover:bg-stone-50'}`}
              >
                {l}
              </button>
            ))}
          </div>
          <button
            onClick={handleLogout}
            className="rounded-lg px-3 py-1.5 text-sm font-medium text-stone-600 hover:bg-stone-100"
          >
            {t('nav.logout')}
          </button>
        </div>
      </header>

      {menuOpen && (
        <div className="fixed inset-0 z-40 lg:hidden">
          <div className="absolute inset-0 bg-black/40" onClick={() => setMenuOpen(false)} />
          <div className="absolute inset-y-0 left-0 flex w-72 flex-col bg-white shadow-xl">
            <div className="flex items-center justify-between pr-3">
              <Brand />
              <button
                onClick={() => setMenuOpen(false)}
                className="rounded-full p-2 text-stone-500 hover:bg-stone-100"
                aria-label="Fermer le menu"
              >
                <svg width="18" height="18" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="M5 5l10 10M15 5L5 15" strokeLinecap="round" />
                </svg>
              </button>
            </div>
            <div className="flex-1 overflow-y-auto py-2">
              <NavList onNavigate={() => setMenuOpen(false)} />
            </div>
          </div>
        </div>
      )}

      <main className="px-3 py-5 sm:px-5 lg:pl-64">
        <div className="mx-auto max-w-6xl lg:pl-4">
          <DbGate>
            <Outlet />
          </DbGate>
        </div>
      </main>
    </div>
  );
}
