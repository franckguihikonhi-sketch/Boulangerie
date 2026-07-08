import { createContext, useContext, useMemo, useState } from 'react';
import { startDemo, stopDemo, DEMO_MS } from './db';

// Authentification de démonstration avec rôles (section 5.8) :
//   - admin     : accès complet (suppressions, Rapports, marges, coûts) ;
//   - operateur : limité à Ventes et Production, sans visibilité sur les
//                 coûts d'achat ni les marges.
//   - invité    : accès « démo » temporaire (30 min) dans un bac à sable
//                 local isolé, avec les droits d'un admin pour tout montrer.
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

// Session invité expirée ? (compte à rebours démarré à la connexion)
function guestExpired(session) {
  return session?.guest && (!session.demoStart || Date.now() >= session.demoStart + DEMO_MS);
}

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [user, setUser] = useState(() => {
    try {
      const session = JSON.parse(localStorage.getItem(SESSION_KEY));
      if (guestExpired(session)) {
        localStorage.removeItem(SESSION_KEY);
        try {
          sessionStorage.setItem('boulange-demo-expired', '1');
        } catch {
          /* ignore */
        }
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
        localStorage.setItem(SESSION_KEY, JSON.stringify(session));
        setUser(session);
        return true;
      },
      // Démarre une session invité : bac à sable local isolé + compte à
      // rebours de 30 minutes qui commence maintenant.
      startGuest() {
        const session = {
          email: 'invite@boulangerie-demo.app',
          name: 'Invité (démo)',
          role: 'admin',
          guest: true,
          demoStart: Date.now()
        };
        localStorage.setItem(SESSION_KEY, JSON.stringify(session));
        startDemo();
        setUser(session);
        return session;
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
        if (user?.guest) stopDemo();
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
