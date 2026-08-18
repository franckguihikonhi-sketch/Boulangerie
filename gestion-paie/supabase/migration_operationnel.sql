-- ===========================================================================
-- PaieCI — migration additive : chantiers opérationnels (audit, email).
-- À coller dans Supabase → SQL Editor → New query → Run, SUR LA BASE DE
-- PRODUCTION existante. Idempotent, non destructif — aucune donnée existante
-- n'est perdue (colonne et table ajoutées avec valeur par défaut).
--
-- Ajoute :
--   - employees.email (texte, facultatif) : sert uniquement à préparer
--       l'envoi du bulletin (Bulletins → « Préparer l'email »), jamais
--       utilisé dans les calculs.
--   - table audit_log (historique des créations/modifications/suppressions
--       de salariés, avec instantané avant/après) — voir page Historique.
--     PAS de clé étrangère vers employees (volontaire) : l'historique reste
--     consultable même après suppression définitive du salarié concerné.
--   - save_employee(jsonb) mis à jour pour lire/écrire le champ email.
--
-- L'import CSV en masse et le solde de tout compte (import précédent) ne
-- nécessitent aucune migration supplémentaire.
-- ===========================================================================

alter table employees add column if not exists email text not null default '';

create table if not exists audit_log (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  employee_id uuid,
  employee_nom text not null default '',
  utilisateur text not null default '',
  action text not null default 'update' check (action in ('create','update','delete')),
  avant jsonb,
  apres jsonb
);
create index if not exists audit_log_employee_id_idx on audit_log (employee_id);
create index if not exists audit_log_created_at_idx on audit_log (created_at desc);

alter table audit_log enable row level security;
drop policy if exists anon_all on audit_log;
create policy anon_all on audit_log for all to anon, authenticated using (true) with check (true);

create or replace function save_employee(p jsonb)
returns uuid language plpgsql as $$
declare
  v_id uuid;
  v_per jsonb;
  v_prime jsonb;
  v_retenue jsonb;
  v_hsup jsonb;
  v_pid uuid;
  v_ppos int := 0;
  v_prpos int;
  v_rpos int;
  v_hpos int;
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
      categorie = coalesce(p->>'categorie',''),
      expatrie = coalesce((p->>'expatrie')::boolean, false),
      date_embauche = nullif(p->>'dateEmbauche','')::date,
      salaire_categoriel = coalesce((p->>'salaireCategoriel')::bigint, 0),
      sous_controle = coalesce((p->>'sousControle')::boolean, false),
      controle_motif = coalesce(p->>'controleMotif',''),
      controle_depuis = nullif(p->>'controleDepuis','')::date,
      compte_bancaire = coalesce(p->>'compteBancaire',''),
      email = coalesce(p->>'email','')
    where id = v_id;
    if not found then raise exception 'Salarié introuvable'; end if;
    delete from periodes where employee_id = v_id;
  else
    insert into employees (matricule, nom, situation, enfants, cnps, emploi, categorie,
      expatrie, date_embauche, salaire_categoriel, sous_controle, controle_motif, controle_depuis,
      compte_bancaire, email)
    values (
      coalesce(p->>'matricule',''), p->>'nom', coalesce(p->>'situation','celibataire'),
      coalesce((p->>'enfants')::int, 0), coalesce(p->>'cnps',''), coalesce(p->>'emploi',''),
      coalesce(p->>'categorie',''),
      coalesce((p->>'expatrie')::boolean, false), nullif(p->>'dateEmbauche','')::date,
      coalesce((p->>'salaireCategoriel')::bigint, 0),
      coalesce((p->>'sousControle')::boolean, false),
      coalesce(p->>'controleMotif',''),
      nullif(p->>'controleDepuis','')::date,
      coalesce(p->>'compteBancaire',''),
      coalesce(p->>'email','')
    ) returning id into v_id;
  end if;

  for v_per in select * from jsonb_array_elements(coalesce(p->'periodes','[]'::jsonb))
  loop
    insert into periodes (employee_id, kind, label, debut, fin, fin_jour, salaire_base, net_cible, transport, position)
    values (
      v_id,
      coalesce(v_per->>'kind','cdd'),
      coalesce(v_per->>'label',''),
      ((v_per->>'debut') || '-01')::date,
      case when coalesce(v_per->>'fin','') = '' then null else ((v_per->>'fin') || '-01')::date end,
      nullif(v_per->>'finJour','')::smallint,
      coalesce((v_per->>'salaireBase')::bigint, 0),
      coalesce((v_per->>'netCible')::bigint, 0),
      coalesce((v_per->>'transport')::bigint, 0),
      v_ppos
    ) returning id into v_pid;
    v_ppos := v_ppos + 1;

    v_prpos := 0;
    for v_prime in select * from jsonb_array_elements(coalesce(v_per->'primes','[]'::jsonb))
    loop
      insert into primes (periode_id, label, montant, imposable, mois, position)
      values (
        v_pid,
        coalesce(nullif(v_prime->>'label',''), 'Prime'),
        coalesce((v_prime->>'montant')::bigint, 0),
        coalesce((v_prime->>'imposable')::boolean, true),
        case when coalesce(v_prime->>'mois','') = '' then null else ((v_prime->>'mois') || '-01')::date end,
        v_prpos
      );
      v_prpos := v_prpos + 1;
    end loop;

    v_rpos := 0;
    for v_retenue in select * from jsonb_array_elements(coalesce(v_per->'retenues','[]'::jsonb))
    loop
      insert into retenues (periode_id, label, montant, mois, position)
      values (
        v_pid,
        coalesce(nullif(v_retenue->>'label',''), 'Retenue'),
        coalesce((v_retenue->>'montant')::bigint, 0),
        case when coalesce(v_retenue->>'mois','') = '' then null else ((v_retenue->>'mois') || '-01')::date end,
        v_rpos
      );
      v_rpos := v_rpos + 1;
    end loop;

    v_hpos := 0;
    for v_hsup in select * from jsonb_array_elements(coalesce(v_per->'heuresSupplementaires','[]'::jsonb))
    loop
      insert into heures_supplementaires (periode_id, heures, majoration, mois, position)
      values (
        v_pid,
        coalesce((v_hsup->>'heures')::numeric, 0),
        coalesce((v_hsup->>'majoration')::numeric, 0),
        case when coalesce(v_hsup->>'mois','') = '' then null else ((v_hsup->>'mois') || '-01')::date end,
        v_hpos
      );
      v_hpos := v_hpos + 1;
    end loop;
  end loop;

  return v_id;
end; $$;

grant execute on function save_employee(jsonb) to anon, authenticated;
