import { createContext, useContext, useMemo, useState } from 'react';

// Authentification de démonstration avec rôles (section 5.8) :
//   - admin     : accès complet (suppressions, Rapports, marges, coûts) ;
//   - operateur : limité à Ventes et Production, sans visibilité sur les
//                 coûts d'achat ni les marges.
// À la migration Supabase : remplacer par Supabase Auth + table profiles
// (le rôle est alors appliqué côté base via Row Level Security).

const USERS_KEY = 'boulange-users';
const SESSION_KEY = 'boulange-session';

function loadUsers() {
  try {
    const raw = localStorage.getItem(USERS_KEY);
    if (raw) return JSON.parse(raw);
  } catch {
    /* ignore */
  }
  const defaults = [
    { email: 'admin@boulangerie.com', password: 'admin123', name: 'Administrateur', role: 'admin' },
    { email: 'vendeur@boulangerie.com', password: 'vendeur123', name: 'Vendeur', role: 'operateur' }
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
      register(name, email, password) {
        const users = loadUsers();
        if (users.some((u) => u.email.toLowerCase() === email.trim().toLowerCase())) return false;
        // Un compte créé en libre-service est Opérateur ; seul un admin
        // existant peut promouvoir un autre administrateur.
        users.push({ email: email.trim(), password, name: name.trim(), role: 'operateur' });
        localStorage.setItem(USERS_KEY, JSON.stringify(users));
        return true;
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
