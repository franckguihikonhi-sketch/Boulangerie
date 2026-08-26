-- ===========================================================================
-- PaieCI — migration additive : clôture des cycles de congés (onglet Congés).
-- À coller dans Supabase → SQL Editor → New query → Run, SUR LA BASE DE
-- PRODUCTION existante. Idempotent, non destructif — aucune donnée existante
-- n'est touchée (nouvelle table uniquement). Complète migration_conges_pris.sql
-- (à exécuter avant celle-ci si ce n'est pas déjà fait).
--
-- Ajoute :
--   - table conges_cycles_clotures : un salarié + un cycle d'acquisition
--       (année antérieure, en cours ou future) peut être marqué CLÔTURÉ une
--       fois ses congés de la période soldés — qui l'a clôturé et quand.
--       Une fois clôturé, l'application refuse d'ajouter ou de supprimer un
--       congé pris daté dans ce cycle (voir src/lib/db.js) tant qu'il n'est
--       pas rouvert — même principe que la clôture mensuelle de la paie.
--   - RLS directement en profiles_only (la base est déjà verrouillée par
--       migration_securite_2_verrouillage.sql au moment de cette migration).
-- ===========================================================================

create table if not exists conges_cycles_clotures (
  id uuid primary key default gen_random_uuid(),
  employee_id uuid not null references employees(id) on delete cascade,
  cycle_debut date not null,
  cloture_le timestamptz not null default now(),
  cloture_par text not null default '',
  unique (employee_id, cycle_debut)
);
create index if not exists conges_cycles_clotures_employee_id_idx on conges_cycles_clotures (employee_id);

alter table conges_cycles_clotures enable row level security;
drop policy if exists anon_all on conges_cycles_clotures;
drop policy if exists profiles_only on conges_cycles_clotures;
create policy profiles_only on conges_cycles_clotures
  for all to authenticated
  using (exists (select 1 from profiles where profiles.id = auth.uid()))
  with check (exists (select 1 from profiles where profiles.id = auth.uid()));
