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
const SUPABASE_ANON_KEY =
  ENV.VITE_SUPABASE_ANON_KEY ||
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imxsbm1ybHlscG1zd3B0YW5jeXNxIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODMyNDA0MTcsImV4cCI6MjA5ODgxNjQxN30.kWCc_vxwxK0RpZWLMTKud-o3-cW4ZkHcK5ggV-5mo7s';

export const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
  auth: { persistSession: false }
});
