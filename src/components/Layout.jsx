import { useState } from 'react';
import { NavLink, Outlet, useNavigate } from 'react-router-dom';
import { useI18n } from '../i18n/I18nContext';
import { useAuth } from '../lib/auth';
import DbGate from './DbGate';
import Logo from './Logo';
import DemoCountdown from './DemoCountdown';

// Menu latéral : les 9 modules dans le MÊME ordre sur desktop et mobile,
// avec le libellé unique « Ventes » (anomalie n°13). Le rôle Opérateur ne
// voit que Ventes et Production (section 5.8).
const NAV_ITEMS = [
  { to: '/', key: 'nav.dashboard', icon: 'M3 12l9-8 9 8M5 10v10h5v-6h4v6h5V10', adminOnly: true },
  { to: '/ingredients', key: 'nav.ingredients', icon: 'M12 3v18M5 8c0 8 14 8 14 0M5 16c0-4 14-4 14 0', adminOnly: true },
  { to: '/produits', key: 'nav.products', icon: 'M4 7l8-4 8 4v10l-8 4-8-4V7M4 7l8 4m0 0l8-4m-8 4v10', adminOnly: true },
  { to: '/achats', key: 'nav.purchases', icon: 'M3 4h2l2 12h11l2-8H6M9 20a1 1 0 100-2 1 1 0 000 2zm8 0a1 1 0 100-2 1 1 0 000 2z', adminOnly: true },
  { to: '/production', key: 'nav.production', icon: 'M12 3a4 4 0 014 4c2 0 4 2 4 4H4c0-2 2-4 4-4a4 4 0 014-4zM5 11v7a2 2 0 002 2h10a2 2 0 002-2v-7', adminOnly: false },
  { to: '/ventes', key: 'nav.sales', icon: 'M4 5h16v4a2 2 0 010 4v4H4v-4a2 2 0 010-4V5zm5 3v8', adminOnly: false },
  { to: '/stocks', key: 'nav.stock', icon: 'M4 8l8-5 8 5v11a1 1 0 01-1 1H5a1 1 0 01-1-1V8zm4 12v-7h8v7', adminOnly: true },
  { to: '/historique', key: 'nav.history', icon: 'M12 8v5l3 2M21 12a9 9 0 11-9-9c3.4 0 6.4 1.9 8 4.7M21 3v5h-5', adminOnly: true },
  { to: '/rapports', key: 'nav.reports', icon: 'M4 20V10m6 10V4m6 16v-7m4 7H2', adminOnly: true },
  { to: '/ecritures-sage', key: 'nav.sage', icon: 'M9 12h6m-6 4h6m-6-8h6M6 3h9l3 3v13a2 2 0 01-2 2H6a2 2 0 01-2-2V5a2 2 0 012-2z', adminOnly: true },
  { to: '/a-propos', key: 'nav.about', icon: 'M12 22c5.523 0 10-4.477 10-10S17.523 2 12 2 2 6.477 2 12s4.477 10 10 10zM12 16v-4M12 8h.01', adminOnly: false }
];

function NavList({ onNavigate }) {
  const { t } = useI18n();
  const { isAdmin } = useAuth();
  const items = NAV_ITEMS.filter((i) => isAdmin || !i.adminOnly);
  return (
    <nav className="flex flex-col gap-0.5 px-2">
      {items.map((item) => (
        <NavLink
          key={item.to}
          to={item.to}
          end={item.to === '/'}
          onClick={onNavigate}
          className={({ isActive }) =>
            `flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium transition ${
              isActive
                ? 'bg-brand-100 text-brand-900'
                : 'text-stone-600 hover:bg-stone-100 hover:text-stone-900'
            }`
          }
        >
          <svg
            width="18"
            height="18"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.8"
            strokeLinecap="round"
            strokeLinejoin="round"
            className="flex-none"
          >
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
      {/* Barre latérale desktop (passe à droite en mode arabe RTL) */}
      <aside className="fixed inset-y-0 left-0 z-30 hidden w-60 flex-col border-r border-stone-200 bg-white lg:flex rtl:left-auto rtl:right-0 rtl:border-l rtl:border-r-0">
        <Brand />
        <div className="flex-1 overflow-y-auto py-2">
          <NavList />
        </div>
        <div className="border-t border-stone-200 p-3 text-xs text-stone-500">
          <p className="font-medium text-stone-700">{user?.name}</p>
          <p>{t(`role.${user?.role}`)}</p>
        </div>
      </aside>

      {/* Barre supérieure */}
      <header className="sticky top-0 z-20 flex h-14 items-center justify-between border-b border-stone-200 bg-white px-3 sm:px-5 lg:pl-64 rtl:lg:pl-3 rtl:lg:pr-64">
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
            {['fr', 'en', 'ar'].map((l) => (
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

      {/* Tiroir mobile : mêmes 9 modules, même ordre que desktop */}
      {menuOpen && (
        <div className="fixed inset-0 z-40 lg:hidden">
          <div className="absolute inset-0 bg-black/40" onClick={() => setMenuOpen(false)} />
          <div className="absolute inset-y-0 left-0 flex w-72 flex-col bg-white shadow-xl rtl:left-auto rtl:right-0">
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
            <div className="border-t border-stone-200 p-3 text-xs text-stone-500">
              <p className="font-medium text-stone-700">{user?.name}</p>
              <p>{t(`role.${user?.role}`)}</p>
            </div>
          </div>
        </div>
      )}

      <main className="px-3 py-5 sm:px-5 lg:pl-64 rtl:lg:pl-3 rtl:lg:pr-64">
        <div className="mx-auto max-w-6xl lg:pl-4 rtl:lg:pl-0 rtl:lg:pr-4">
          <DbGate>
            <Outlet />
          </DbGate>
        </div>
      </main>
    </div>
  );
}
