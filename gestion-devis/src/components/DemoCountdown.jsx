import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../lib/auth';
import { useI18n } from '../i18n/I18nContext';
import { DEMO_MS } from '../lib/db';

// Compte à rebours de la session invité, affiché dans l'en-tête. Démarre à la
// connexion et, à zéro, ferme automatiquement la session de démonstration.
export default function DemoCountdown() {
  const { isGuest, demoStart, logout } = useAuth();
  const { t } = useI18n();
  const navigate = useNavigate();
  const [remaining, setRemaining] = useState(() => (demoStart ? demoStart + DEMO_MS - Date.now() : 0));

  useEffect(() => {
    if (!isGuest || !demoStart) return undefined;
    const tick = () => {
      const r = demoStart + DEMO_MS - Date.now();
      setRemaining(r);
      if (r <= 0) {
        try {
          sessionStorage.setItem('gdevis-demo-expired', '1');
        } catch {
          /* ignore */
        }
        logout();
        navigate('/login', { replace: true });
      }
    };
    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, [isGuest, demoStart, logout, navigate]);

  if (!isGuest || !demoStart) return null;

  const total = Math.max(0, remaining);
  const mm = String(Math.floor(total / 60000)).padStart(2, '0');
  const ss = String(Math.floor((total % 60000) / 1000)).padStart(2, '0');
  const low = total <= 5 * 60000;

  return (
    <span
      title={t('demo.title')}
      className={`flex flex-none items-center gap-1.5 rounded-lg px-2 py-1.5 text-xs font-semibold tabular-nums ${
        low ? 'bg-red-100 text-red-700' : 'bg-amber-100 text-amber-800'
      }`}
    >
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"
        strokeLinecap="round" strokeLinejoin="round" className="flex-none">
        <circle cx="12" cy="13" r="8" />
        <path d="M12 9v4l2 2M9 2h6" />
      </svg>
      <span className="hidden sm:inline">{t('demo.title')} ·</span> {mm}:{ss}
    </span>
  );
}
