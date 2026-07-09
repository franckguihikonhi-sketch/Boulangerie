import { useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../lib/auth';

// Point d'entrée du lien de démo (#/demo) : démarre immédiatement une session
// invité (bac à sable local, compte à rebours de 30 minutes) puis redirige
// vers le tableau de bord.
export default function DemoEntry() {
  const { startGuest } = useAuth();
  const navigate = useNavigate();
  const started = useRef(false);

  useEffect(() => {
    if (!started.current) {
      started.current = true;
      startGuest();
    }
    navigate('/', { replace: true });
  }, [navigate, startGuest]);

  return (
    <div className="flex min-h-screen items-center justify-center bg-stone-50">
      <span className="h-8 w-8 animate-spin rounded-full border-2 border-brand-200 border-t-brand-600" />
    </div>
  );
}
