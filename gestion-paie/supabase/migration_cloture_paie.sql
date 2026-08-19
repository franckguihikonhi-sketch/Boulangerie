-- ===========================================================================
-- PaieCI — migration additive : clôture mensuelle de la paie.
-- À coller dans Supabase → SQL Editor → New query → Run, SUR LA BASE DE
-- PRODUCTION existante. Idempotent, non destructif — aucune donnée existante
-- n'est touchée (nouvelle table uniquement).
--
-- Ajoute :
--   - table clotures_paie : une ligne par mois (aaaa-mm) officiellement
--       clôturé — qui l'a clôturé et quand. Sert de MARQUEUR partagé entre
--       tous les utilisateurs (visible depuis le bouton « Base », le Livre
--       de paie et le Tableau de bord) et de GARDE-FOU : une fois un mois
--       clôturé, toute modification d'un salarié qui changerait le bulletin
--       déjà calculé de ce mois est refusée côté application (voir
--       src/lib/cloture.js) tant que le mois n'est pas rouvert.
--   - RLS directement en profiles_only (la base est déjà verrouillée par
--       migration_securite_2_verrouillage.sql au moment de cette migration).
--   - RPC save_cloture / annuler_cloture, cohérent avec le reste de l'appli
--       (voir save_versement dans migration_conformite.sql).
-- ===========================================================================

create table if not exists clotures_paie (
  ym date primary key,
  cloture_le timestamptz not null default now(),
  cloture_par text not null default ''
);

alter table clotures_paie enable row level security;
drop policy if exists anon_all on clotures_paie;
drop policy if exists profiles_only on clotures_paie;
create policy profiles_only on clotures_paie
  for all to authenticated
  using (exists (select 1 from profiles where profiles.id = auth.uid()))
  with check (exists (select 1 from profiles where profiles.id = auth.uid()));

create or replace function save_cloture(p_ym text, p_cloture_par text)
returns void language plpgsql as $$
begin
  insert into clotures_paie (ym, cloture_le, cloture_par)
  values ((p_ym || '-01')::date, now(), coalesce(p_cloture_par, ''))
  on conflict (ym) do update set
    cloture_le = now(),
    cloture_par = coalesce(p_cloture_par, '');
end; $$;

create or replace function annuler_cloture(p_ym text)
returns void language plpgsql as $$
begin
  delete from clotures_paie where ym = (p_ym || '-01')::date;
end; $$;

grant execute on function save_cloture(text, text) to authenticated;
grant execute on function annuler_cloture(text) to authenticated;
