import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../lib/auth';
import { DEMO_MS } from '../lib/db';

// Compte à rebours de la session invité (démo) : 30 minutes. À expiration, on
// déconnecte automatiquement et on renvoie vers l'écran de connexion.
export default function DemoCountdown() {
  const { isGuest, demoStart, logout } = useAuth();
  const navigate = useNavigate();
  const [remaining, setRemaining] = useState(0);

  useEffect(() => {
    if (!isGuest || !demoStart) return undefined;
    const tick = () => {
      const left = demoStart + DEMO_MS - Date.now();
      setRemaining(left);
      if (left <= 0) {
        logout();
        navigate('/login');
      }
    };
    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, [isGuest, demoStart, logout, navigate]);

  if (!isGuest || !demoStart || remaining <= 0) return null;

  const min = Math.floor(remaining / 60000);
  const sec = Math.floor((remaining % 60000) / 1000);
  const low = remaining < 5 * 60000;

  return (
    <span
      className={`hidden items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-xs font-semibold sm:inline-flex ${
        low ? 'bg-red-100 text-red-700' : 'bg-brand-100 text-brand-800'
      }`}
      title="Session de démonstration"
    >
      <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
        <circle cx="12" cy="12" r="9" />
        <path d="M12 7v5l3 2" strokeLinecap="round" />
      </svg>
      Démo {min}:{String(sec).padStart(2, '0')}
    </span>
  );
}
