-- ===========================================================================
-- PaieCI — sécurité (partie 1/2) : table profiles.
-- À coller dans Supabase → SQL Editor → New query → Run, SUR LA BASE DE
-- PRODUCTION existante. SANS DANGER À EXÉCUTER MAINTENANT : cette partie ne
-- touche à AUCUNE des règles d'accès existantes (les tables restent lisibles/
-- modifiables comme avant) — elle prépare seulement le terrain. Le
-- verrouillage réel se fait dans la partie 2/2, une fois les comptes créés
-- et la connexion testée avec succès.
--
-- Ajoute :
--   - table profiles : une ligne par personne AUTORISÉE à utiliser
--       l'application. Un compte Supabase Auth qui n'a PAS de ligne ici
--       n'aura accès à AUCUNE donnée une fois la partie 2/2 appliquée — même
--       s'il parvient à se créer un compte par un autre moyen. C'est cette
--       table qui remplace la clé anon comme unique porte d'entrée.
--   - RLS sur profiles : chacun ne peut lire QUE sa propre ligne (jamais la
--       liste des autres utilisateurs). Aucune règle d'écriture pour les
--       utilisateurs standards : profiles ne se modifie que depuis le SQL
--       Editor (ce script), jamais depuis l'application.
-- ===========================================================================

create table if not exists profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  email text not null default '',
  name text not null default '',
  role text not null default 'gestionnaire' check (role in ('admin','gestionnaire')),
  created_at timestamptz not null default now()
);

alter table profiles enable row level security;
drop policy if exists self_select on profiles;
create policy self_select on profiles for select to authenticated using (auth.uid() = id);
