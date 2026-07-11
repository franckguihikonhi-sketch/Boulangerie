-- ===========================================================================
-- Écritures SAGE — Script de création de la base Supabase (à coller tel quel
-- dans Supabase → SQL Editor → New query → Run).
--
-- Base DÉDIÉE à cette application, indépendante de tout autre projet.
-- Fonctionne avec la clé publique (anon) SANS Supabase Auth. Idempotent.
-- ===========================================================================

-- Écritures comptables destinées à l'export SAGE 100 Comptabilité.
-- Montants en FCFA entiers. Création idempotente : conserve les écritures.
create table if not exists sage_entries (
  id uuid primary key default gen_random_uuid(),
  journal text not null,                         -- code journal (VT, AC, OD…)
  piece_date date not null,                       -- date de pièce
  account text not null,                          -- n° compte général
  label text not null default '',                 -- libellé écriture
  debit bigint not null default 0 check (debit >= 0),
  credit bigint not null default 0 check (credit >= 0),
  created_at timestamptz not null default now()   -- ordre de saisie
);
create index if not exists sage_entries_created_idx on sage_entries (created_at);

-- Sécurité (RLS) ------------------------------------------------------------
-- MVP : on active RLS et on autorise la clé publique (anon) à lire/écrire.
-- ⚠️ Quiconque possède la clé publique peut accéder aux données. Suffisant
--    pour un usage de confiance ; pour la production, activer Supabase Auth.
alter table sage_entries enable row level security;
drop policy if exists anon_all on sage_entries;
create policy anon_all on sage_entries for all to anon, authenticated using (true) with check (true);
