import { createContext, useContext, useMemo, useState } from 'react';

// Authentification (démonstration) avec deux rôles :
//   - admin        : le « Responsable RH / paie » — accès complet ;
//   - gestionnaire : saisit les salariés et édite les bulletins.
// Les données de paie sont locales à l'appareil (voir lib/db.js). À la
// migration Supabase : remplacer par Supabase Auth + table profiles, le rôle
// étant alors appliqué côté base via Row Level Security.

const USERS_KEY = 'gpaie-users';
const SESSION_KEY = 'gpaie-session';

function loadUsers() {
  try {
    const raw = localStorage.getItem(USERS_KEY);
    if (raw) return JSON.parse(raw);
  } catch {
    /* ignore */
  }
  const defaults = [
    { email: 'admin@paie.ci', password: 'admin123', name: 'Responsable Paie', role: 'admin' },
    { email: 'rh@paie.ci', password: 'rh123', name: 'Gestionnaire RH', role: 'gestionnaire' }
  ];
  localStorage.setItem(USERS_KEY, JSON.stringify(defaults));
  return defaults;
}

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [user, setUser] = useState(() => {
    try {
      return JSON.parse(localStorage.getItem(SESSION_KEY));
    } catch {
      return null;
    }
  });

  const value = useMemo(
    () => ({
      user,
      isAdmin: user?.role === 'admin',
      login(email, password) {
        const found = loadUsers().find(
          (u) => u.email.toLowerCase() === email.trim().toLowerCase() && u.password === password
        );
        if (!found) return false;
        const session = { email: found.email, name: found.name, role: found.role };
        localStorage.setItem(SESSION_KEY, JSON.stringify(session));
        setUser(session);
        return true;
      },
      startGuest() {
        const session = { email: 'invite@paie.ci', name: 'Invité (démo)', role: 'admin', guest: true };
        localStorage.setItem(SESSION_KEY, JSON.stringify(session));
        setUser(session);
        return session;
      },
      logout() {
        localStorage.removeItem(SESSION_KEY);
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
