import { createClient } from '@supabase/supabase-js';

// Connexion à la base Supabase DÉDIÉE à cette application (Wave → SAGE).
// Cette base est INDÉPENDANTE de tout autre projet du dépôt : elle a son propre
// projet Supabase, renseigné via les variables d'environnement VITE_SUPABASE_*.
//
// L'URL et la clé « anon » (publishable) sont PUBLIQUES par conception : elles
// sont livrées dans le bundle du navigateur, la protection réelle se fait côté
// base via Row Level Security. Sans configuration, l'application fonctionne en
// mode LOCAL (navigateur), pleinement utilisable et hors-ligne.
//
// Ne JAMAIS mettre ici la clé « secret » (sb_secret_…) : accès total, réservé
// au serveur.
const ENV = (typeof import.meta !== 'undefined' && import.meta.env) || {};
const SUPABASE_URL = ENV.VITE_SUPABASE_URL || '';
const SUPABASE_ANON_KEY = ENV.VITE_SUPABASE_ANON_KEY || '';

export const supabase = createClient(
  SUPABASE_URL || 'https://placeholder.supabase.co',
  SUPABASE_ANON_KEY || 'placeholder-anon-key',
  { auth: { persistSession: false } }
);

// Vrai seulement si une vraie base dédiée est configurée.
export const supabaseConfigured = Boolean(SUPABASE_URL && SUPABASE_ANON_KEY);
