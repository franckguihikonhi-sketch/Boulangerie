import { createClient } from '@supabase/supabase-js';

// Connexion au projet Supabase.
// L'URL et la clé « anon » sont des valeurs PUBLIQUES par conception (elles
// sont livrées dans le bundle du navigateur) ; leur présence ici est normale.
// La protection réelle des données se fait côté base via Row Level Security.
// On lit d'abord les variables d'environnement (VITE_*), avec repli sur les
// constantes du projet pour que le build GitHub Pages fonctionne sans réglage.
const ENV = (typeof import.meta !== 'undefined' && import.meta.env) || {};
const SUPABASE_URL =
  ENV.VITE_SUPABASE_URL || 'https://llnmrlylpmswptancysq.supabase.co';
// Clé PUBLISHABLE (publique par conception, protégée côté base par RLS).
// Ne JAMAIS mettre ici la clé « secret » (sb_secret_…) : elle donne un accès
// administrateur total et n'a rien à faire dans un bundle navigateur.
const SUPABASE_ANON_KEY =
  ENV.VITE_SUPABASE_ANON_KEY || 'sb_publishable_oKTwjR1moLiwLMNxMPBV_g_cMe9cFDk';

export const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
  auth: { persistSession: false }
});
