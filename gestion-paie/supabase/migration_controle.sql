-- ===========================================================================
-- PaieCI — migration additive : marquage « sous contrôle » d'un salarié.
-- À coller dans Supabase → SQL Editor → New query → Run.
--
-- Idempotent et SANS PERTE DE DONNÉES : n'ajoute que des colonnes optionnelles
-- (valeurs par défaut) et remplace la fonction save_employee. Ne touche à
-- aucune donnée existante. Sûr à exécuter sur une base déjà en production.
-- ===========================================================================

alter table employees add column if not exists sous_controle boolean not null default false;
alter table employees add column if not exists controle_motif text not null default '';
alter table employees add column if not exists controle_depuis date;

create or replace function save_employee(p jsonb)
returns uuid language plpgsql as $$
declare
  v_id uuid;
  v_per jsonb;
  v_prime jsonb;
  v_pid uuid;
  v_ppos int := 0;
  v_prpos int;
begin
  if coalesce(p->>'nom','') = '' then
    raise exception 'Le nom du salarié est obligatoire';
  end if;

  if (p->>'id') is not null and (p->>'id') <> '' then
    v_id := (p->>'id')::uuid;
    update employees set
      matricule = coalesce(p->>'matricule',''),
      nom = p->>'nom',
      situation = coalesce(p->>'situation','celibataire'),
      enfants = coalesce((p->>'enfants')::int, 0),
      cnps = coalesce(p->>'cnps',''),
      emploi = coalesce(p->>'emploi',''),
      expatrie = coalesce((p->>'expatrie')::boolean, false),
      date_embauche = nullif(p->>'dateEmbauche','')::date,
      salaire_categoriel = coalesce((p->>'salaireCategoriel')::bigint, 0),
      sous_controle = coalesce((p->>'sousControle')::boolean, false),
      controle_motif = coalesce(p->>'controleMotif',''),
      controle_depuis = nullif(p->>'controleDepuis','')::date
    where id = v_id;
    if not found then raise exception 'Salarié introuvable'; end if;
    delete from periodes where employee_id = v_id;
  else
    insert into employees (matricule, nom, situation, enfants, cnps, emploi,
      expatrie, date_embauche, salaire_categoriel, sous_controle, controle_motif, controle_depuis)
    values (
      coalesce(p->>'matricule',''), p->>'nom', coalesce(p->>'situation','celibataire'),
      coalesce((p->>'enfants')::int, 0), coalesce(p->>'cnps',''), coalesce(p->>'emploi',''),
      coalesce((p->>'expatrie')::boolean, false), nullif(p->>'dateEmbauche','')::date,
      coalesce((p->>'salaireCategoriel')::bigint, 0),
      coalesce((p->>'sousControle')::boolean, false),
      coalesce(p->>'controleMotif',''),
      nullif(p->>'controleDepuis','')::date
    ) returning id into v_id;
  end if;

  for v_per in select * from jsonb_array_elements(coalesce(p->'periodes','[]'::jsonb))
  loop
    insert into periodes (employee_id, kind, label, debut, fin, salaire_base, net_cible, transport, position)
    values (
      v_id,
      coalesce(v_per->>'kind','cdd'),
      coalesce(v_per->>'label',''),
      ((v_per->>'debut') || '-01')::date,
      case when coalesce(v_per->>'fin','') = '' then null else ((v_per->>'fin') || '-01')::date end,
      coalesce((v_per->>'salaireBase')::bigint, 0),
      coalesce((v_per->>'netCible')::bigint, 0),
      coalesce((v_per->>'transport')::bigint, 0),
      v_ppos
    ) returning id into v_pid;
    v_ppos := v_ppos + 1;

    v_prpos := 0;
    for v_prime in select * from jsonb_array_elements(coalesce(v_per->'primes','[]'::jsonb))
    loop
      insert into primes (periode_id, label, montant, imposable, position)
      values (
        v_pid,
        coalesce(nullif(v_prime->>'label',''), 'Prime'),
        coalesce((v_prime->>'montant')::bigint, 0),
        coalesce((v_prime->>'imposable')::boolean, true),
        v_prpos
      );
      v_prpos := v_prpos + 1;
    end loop;
  end loop;

  return v_id;
end; $$;

grant execute on function save_employee(jsonb) to anon, authenticated;
