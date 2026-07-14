import { useState } from 'react';
import { NavLink, Outlet, useNavigate } from 'react-router-dom';
import { useI18n } from '../i18n/I18nContext';
import { useAuth } from '../lib/auth';
import DbGate from './DbGate';
import Logo from './Logo';
import DemoCountdown from './DemoCountdown';

const NAV_ITEMS = [
  { to: '/', key: 'nav.dashboard', icon: 'M3 12l9-8 9 8M5 10v10h5v-6h4v6h5V10' },
  { to: '/salaries', key: 'nav.employees', icon: 'M12 12a4 4 0 100-8 4 4 0 000 8zm-7 8a7 7 0 0114 0' },
  { to: '/bulletins', key: 'nav.bulletins', icon: 'M7 3h7l5 5v13H5V5a2 2 0 012-2zm7 0v5h5M8 13h8M8 17h5' },
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
