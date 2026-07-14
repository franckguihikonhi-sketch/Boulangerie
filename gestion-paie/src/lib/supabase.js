import { createClient } from '@supabase/supabase-js';

// Connexion au projet Supabase. L'URL et la clé « anon » sont PUBLIQUES par
// conception (livrées dans le bundle) ; la protection réelle se fait côté base
// via Row Level Security. On lit d'abord les variables d'environnement VITE_*
// (secrets du dépôt, prioritaires en production), avec repli sur le projet
// Supabase du client (branché directement ici pour fonctionner même sans
// configurer de secrets GitHub Actions). Ne JAMAIS mettre ici la clé
// « secret »/« service_role » : accès total, réservée exclusivement au
// serveur, jamais au bundle navigateur.
const ENV = (typeof import.meta !== 'undefined' && import.meta.env) || {};
const FALLBACK_URL = 'https://llnmrlylpmswptancysq.supabase.co';
const FALLBACK_ANON_KEY =
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imxsbm1ybHlscG1zd3B0YW5jeXNxIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODMyNDA0MTcsImV4cCI6MjA5ODgxNjQxN30.kWCc_vxwxK0RpZWLMTKud-o3-cW4ZkHcK5ggV-5mo7s';
const SUPABASE_URL = ENV.VITE_SUPABASE_URL || FALLBACK_URL;
const SUPABASE_ANON_KEY = ENV.VITE_SUPABASE_ANON_KEY || FALLBACK_ANON_KEY;

export const supabase = createClient(
  SUPABASE_URL || 'https://placeholder.supabase.co',
  SUPABASE_ANON_KEY || 'placeholder-anon-key',
  { auth: { persistSession: false } }
);

export const supabaseConfigured = Boolean(SUPABASE_URL && SUPABASE_ANON_KEY);
