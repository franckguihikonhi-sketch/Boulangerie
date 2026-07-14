import { createContext, useContext, useMemo, useState } from 'react';
import { startDemo, stopDemo, DEMO_MS } from './db';
import { safeGet, safeSet, safeRemove } from './storage';

// Authentification (démonstration) avec deux rôles :
//   - admin        : le « Responsable RH / paie » — accès complet ;
//   - gestionnaire : saisit les salariés et édite les bulletins ;
//   - invité       : accès démo temporaire (30 min) dans un bac à sable local
//                    isolé, avec les droits d'un Responsable pour tout montrer.
// À la migration Supabase : remplacer par Supabase Auth + table profiles, le
// rôle étant alors appliqué côté base via Row Level Security.

const USERS_KEY = 'gpaie-users';
const SESSION_KEY = 'gpaie-session';

function loadUsers() {
  try {
    const raw = safeGet(USERS_KEY);
    if (raw) return JSON.parse(raw);
  } catch {
    /* ignore */
  }
  const defaults = [
    { email: 'admin@paie.ci', password: 'admin123', name: 'Responsable Paie', role: 'admin' },
    { email: 'rh@paie.ci', password: 'rh123', name: 'Gestionnaire RH', role: 'gestionnaire' }
  ];
  safeSet(USERS_KEY, JSON.stringify(defaults));
  return defaults;
}

// Session invité expirée ? (compte à rebours démarré à la connexion)
function guestExpired(session) {
  return session?.guest && (!session.demoStart || Date.now() >= session.demoStart + DEMO_MS);
}

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [user, setUser] = useState(() => {
    try {
      const session = JSON.parse(safeGet(SESSION_KEY));
      if (guestExpired(session)) {
        safeRemove(SESSION_KEY);
        return null;
      }
      return session;
    } catch {
      return null;
    }
  });

  const value = useMemo(
    () => ({
      user,
      isAdmin: user?.role === 'admin',
      isGuest: !!user?.guest,
      demoStart: user?.demoStart || null,
      login(email, password) {
        const found = loadUsers().find(
          (u) => u.email.toLowerCase() === email.trim().toLowerCase() && u.password === password
        );
        if (!found) return false;
        const session = { email: found.email, name: found.name, role: found.role };
        safeSet(SESSION_KEY, JSON.stringify(session));
        setUser(session);
        return true;
      },
      // Démarre une session invité : bac à sable local isolé + compte à rebours
      // de 30 minutes qui commence maintenant.
      startGuest() {
        const session = {
          email: 'invite@paie.ci', name: 'Invité (démo)', role: 'admin',
          guest: true, demoStart: Date.now()
        };
        safeSet(SESSION_KEY, JSON.stringify(session));
        startDemo();
        setUser(session);
        return session;
      },
      logout() {
        if (user?.guest) stopDemo();
        safeRemove(SESSION_KEY);
        setUser(null);
      }
    }),
    [user]
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  return useContext(AuthContext);
}
