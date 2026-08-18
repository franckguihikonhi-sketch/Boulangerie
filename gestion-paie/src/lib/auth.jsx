import { createContext, useContext, useEffect, useMemo, useState } from 'react';
import { startDemo, stopDemo, DEMO_MS } from './db';
import { supabase, supabaseConfigured } from './supabase';
import { safeGet, safeSet, safeRemove } from './storage';

// Authentification :
//   - Si Supabase est configuré (cas de ce déploiement) : VRAIE authentification
//     via Supabase Auth (email + mot de passe). Les comptes sont créés depuis
//     le tableau de bord Supabase (Authentication -> Users), JAMAIS depuis
//     l'application — aucune inscription publique n'est exposée ici. Le nom
//     affiché et le rôle viennent de la table `profiles` (une ligne par
//     utilisateur autorisé), qui est aussi la base des politiques RLS : un
//     compte authentifié SANS ligne dans `profiles` n'a accès à AUCUNE
//     donnée (voir migration_securite.sql). Tant que `profiles` n'existe pas
//     encore (avant cette migration), on se contente d'afficher l'email —
//     l'accès aux données reste alors régi par les anciennes règles (anon),
//     sans régression le temps de la bascule.
//   - Si Supabase n'est PAS configuré (usage local, aucune donnée partagée) :
//     repli sur un login local factice, sans risque puisque rien ne quitte
//     jamais le navigateur dans ce mode.
//   - invité : accès démo temporaire (30 min) dans un bac à sable local
//     isolé, qui ne touche jamais la vraie base, quel que soit le mode.

const USERS_KEY = 'gpaie-users';
const SESSION_KEY = 'gpaie-session';

function loadLocalUsers() {
  try {
    const raw = safeGet(USERS_KEY);
    if (raw) return JSON.parse(raw);
  } catch {
    /* ignore */
  }
  const defaults = [{ email: 'admin@local', password: 'admin123', name: 'Administrateur local', role: 'admin' }];
  safeSet(USERS_KEY, JSON.stringify(defaults));
  return defaults;
}

// Session invité expirée ? (compte à rebours démarré à la connexion)
function guestExpired(session) {
  return session?.guest && (!session.demoStart || Date.now() >= session.demoStart + DEMO_MS);
}

// Session invité ou locale déjà persistée (restauration synchrone, pour
// éviter un flash "non connecté" au chargement). Une session Supabase
// réelle, elle, est restaurée juste après, de façon asynchrone (voir l'effet
// dans AuthProvider), gérée par supabase-js.
function restoreLocalSession() {
  try {
    const session = JSON.parse(safeGet(SESSION_KEY));
    if (guestExpired(session)) {
      safeRemove(SESSION_KEY);
      return null;
    }
    return session?.guest || session?.local ? session : null;
  } catch {
    return null;
  }
}

async function fetchProfile(id) {
  try {
    const { data, error } = await supabase.from('profiles').select('*').eq('id', id).maybeSingle();
    if (error || !data) return null;
    return data;
  } catch {
    return null;
  }
}

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [user, setUser] = useState(restoreLocalSession);
  // Tant que authReady est faux, on ne sait pas encore s'il existe une
  // session Supabase réelle persistée (restauration asynchrone) : App.jsx
  // attend ce signal avant de rediriger vers /login, pour ne jamais
  // déconnecter à tort quelqu'un déjà connecté au rechargement de la page.
  const [authReady, setAuthReady] = useState(() => !supabaseConfigured || restoreLocalSession() !== null);

  useEffect(() => {
    if (!supabaseConfigured) return undefined;
    let cancelled = false;

    const applySession = async (session) => {
      if (!session) {
        if (!cancelled) setUser((u) => (u?.guest || u?.local ? u : null));
      } else {
        const profile = await fetchProfile(session.user.id);
        if (cancelled) return;
        setUser({
          id: session.user.id,
          email: session.user.email,
          name: profile?.name || session.user.email,
          role: profile?.role || 'gestionnaire'
        });
      }
      if (!cancelled) setAuthReady(true);
    };

    supabase.auth.getSession().then(({ data }) => applySession(data.session));
    const { data: sub } = supabase.auth.onAuthStateChange((_event, session) => applySession(session));

    return () => {
      cancelled = true;
      sub.subscription.unsubscribe();
    };
  }, []);

  const value = useMemo(
    () => ({
      user,
      authReady,
      isAdmin: user?.role === 'admin',
      isGuest: !!user?.guest,
      demoStart: user?.demoStart || null,
      async login(email, password) {
        if (supabaseConfigured) {
          // La connexion appelle un vrai service réseau (Supabase Auth) :
          // contrairement à l'ancien login local, elle peut échouer pour des
          // raisons hors du contrôle de l'utilisateur (coupure réseau,
          // service indisponible). On protège l'appel par un try/catch ET un
          // délai maximal, pour ne jamais laisser le bouton bloqué sur
          // « Connexion… » indéfiniment ni faire planter la page.
          // Toute exception ici (fetch/réseau, ou le minuteur ci-dessous) est
          // par nature un problème de TRANSPORT, jamais une réponse « mot de
          // passe incorrect » — Supabase renvoie ce cas normalement, sans
          // lever d'exception (voir `error` plus bas). D'où le code générique
          // unique 'network', distingué du reste dans Login.jsx.
          let result;
          try {
            result = await Promise.race([
              supabase.auth.signInWithPassword({ email: email.trim(), password }),
              new Promise((_, reject) => setTimeout(() => reject(new Error('timeout')), 15000))
            ]);
          } catch {
            return { ok: false, error: 'network' };
          }
          const { data, error } = result;
          if (error || !data.session) return { ok: false, error: error?.message };
          const profile = await fetchProfile(data.session.user.id);
          setUser({
            id: data.session.user.id,
            email: data.session.user.email,
            name: profile?.name || data.session.user.email,
            role: profile?.role || 'gestionnaire'
          });
          return { ok: true };
        }
        // Mode local (aucune base partagée) : login factice, sans risque
        // puisque rien ne quitte jamais ce navigateur.
        const found = loadLocalUsers().find(
          (u) => u.email.toLowerCase() === email.trim().toLowerCase() && u.password === password
        );
        if (!found) return { ok: false };
        const session = { email: found.email, name: found.name, role: found.role, local: true };
        safeSet(SESSION_KEY, JSON.stringify(session));
        setUser(session);
        return { ok: true };
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
      async logout() {
        if (user?.guest) stopDemo();
        else if (supabaseConfigured && !user?.local) await supabase.auth.signOut();
        safeRemove(SESSION_KEY);
        setUser(null);
      }
    }),
    [user, authReady]
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  return useContext(AuthContext);
}
