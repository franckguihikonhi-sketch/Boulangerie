-- ===========================================================================
-- PaieCI — migration additive : congés pris (onglet Congés).
-- À coller dans Supabase → SQL Editor → New query → Run, SUR LA BASE DE
-- PRODUCTION existante. Idempotent, non destructif — aucune donnée existante
-- n'est touchée (nouvelle table uniquement).
--
-- Ajoute :
--   - table conges_pris : chaque ligne = une période de congé effectivement
--       posée par un salarié (dates, nombre de jours, commentaire). Sert à
--       calculer le solde de congés affiché dans l'onglet Congés (jours
--       acquis dans le cycle en cours − jours déjà pris sur ce cycle).
--       N'affecte JAMAIS le calcul de paie (l'indemnité de congé versée au
--       mois anniversaire, voir bulletin.js, reste calculée comme avant) —
--       c'est un module de suivi RH, distinct du moteur de paie.
--   - RLS directement en profiles_only (la base est déjà verrouillée par
--       migration_securite_2_verrouillage.sql au moment de cette migration).
-- ===========================================================================

create table if not exists conges_pris (
  id uuid primary key default gen_random_uuid(),
  employee_id uuid not null references employees(id) on delete cascade,
  debut date not null,
  fin date not null,
  jours numeric not null default 0 check (jours >= 0),
  commentaire text not null default '',
  cree_par text not null default '',
  created_at timestamptz not null default now()
);
create index if not exists conges_pris_employee_id_idx on conges_pris (employee_id);

alter table conges_pris enable row level security;
drop policy if exists anon_all on conges_pris;
drop policy if exists profiles_only on conges_pris;
create policy profiles_only on conges_pris
  for all to authenticated
  using (exists (select 1 from profiles where profiles.id = auth.uid()))
  with check (exists (select 1 from profiles where profiles.id = auth.uid()));
