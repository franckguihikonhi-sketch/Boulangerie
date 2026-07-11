import { createClient } from '@supabase/supabase-js';

// Connexion au projet Supabase dédié à cette application.
// L'URL et la clé « anon » (publishable) sont PUBLIQUES par conception : elles
// sont livrées dans le bundle du navigateur, la protection réelle se fait côté
// base via Row Level Security. On lit les variables d'environnement (VITE_*) ;
// renseignez VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY pour brancher votre
// base. Sans configuration, l'application fonctionne en mode LOCAL (les
// écritures sont conservées dans le navigateur).
const ENV = (typeof import.meta !== 'undefined' && import.meta.env) || {};
const SUPABASE_URL = ENV.VITE_SUPABASE_URL || '';
// Ne JAMAIS mettre ici la clé « secret » (sb_secret_…) : accès total, réservée
// au serveur.
const SUPABASE_ANON_KEY = ENV.VITE_SUPABASE_ANON_KEY || '';

export const supabase = createClient(
  SUPABASE_URL || 'https://placeholder.supabase.co',
  SUPABASE_ANON_KEY || 'placeholder-anon-key',
  { auth: { persistSession: false } }
);

// Vrai seulement si une vraie base est configurée. Sinon l'application bascule
// automatiquement sur le stockage local du navigateur.
export const supabaseConfigured = Boolean(SUPABASE_URL && SUPABASE_ANON_KEY);
