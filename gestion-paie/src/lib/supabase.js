import { createClient } from '@supabase/supabase-js';

// Connexion au projet Supabase. L'URL et la clé « anon » sont PUBLIQUES par
// conception (livrées dans le bundle) ; la protection réelle se fait côté base
// via Row Level Security. On lit d'abord les variables d'environnement VITE_*,
// avec repli sur un placeholder pour que le build fonctionne sans réglage :
// l'application reste alors pleinement utilisable en mode démonstration local.
const ENV = (typeof import.meta !== 'undefined' && import.meta.env) || {};
const SUPABASE_URL = ENV.VITE_SUPABASE_URL || '';
// Ne JAMAIS mettre ici la clé « secret » (sb_secret_…) : accès total, réservé
// au serveur.
const SUPABASE_ANON_KEY = ENV.VITE_SUPABASE_ANON_KEY || '';

export const supabase = createClient(
  SUPABASE_URL || 'https://placeholder.supabase.co',
  SUPABASE_ANON_KEY || 'placeholder-anon-key',
  { auth: { persistSession: false } }
);

export const supabaseConfigured = Boolean(SUPABASE_URL && SUPABASE_ANON_KEY);
