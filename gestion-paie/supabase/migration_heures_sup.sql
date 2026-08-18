-- ===========================================================================
-- PaieCI — migration additive : heures supplémentaires + ciblage par mois
-- des retenues particulières.
-- À coller dans Supabase → SQL Editor → New query → Run, SUR LA BASE DE
-- PRODUCTION existante. Idempotent, non destructif — aucune donnée existante
-- n'est perdue (colonne ajoutée avec valeur par défaut nulle = comportement
-- inchangé pour les retenues déjà saisies ; table nouvelle).
--
-- Ajoute :
--   - retenues.mois (date, optionnelle) : laissée vide, une retenue continue
--       de s'appliquer à tous les bulletins de sa période (comportement
--       actuel inchangé) ; renseignée, elle ne s'applique qu'à ce mois-là.
--   - table heures_supplementaires (nombre d'heures + majoration légale par
--       période, avec le même ciblage par mois optionnel).
--   - save_employee(jsonb) mis à jour pour lire/écrire ces nouveaux champs.
-- ===========================================================================

alter table retenues add column if not exists mois date;

create table if not exists heures_supplementaires (
  id uuid primary key default gen_random_uuid(),
  periode_id uuid not null references periodes(id) on delete cascade,
  heures numeric not null default 0 check (heures >= 0),
  majoration numeric not null default 0 check (majoration >= 0),
  mois date,
  position int not null default 0
);
create index if not exists heures_supplementaires_periode_id_idx on heures_supplementaires (periode_id);

alter table heures_supplementaires enable row level security;
drop policy if exists anon_all on heures_supplementaires;
create policy anon_all on heures_supplementaires for all to anon, authenticated using (true) with check (true);

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
      controle_depuis = nullif(p->>'controleDepuis','')::date
    where id = v_id;
    if not found then raise exception 'Salarié introuvable'; end if;
    delete from periodes where employee_id = v_id;
  else
    insert into employees (matricule, nom, situation, enfants, cnps, emploi, categorie,
      expatrie, date_embauche, salaire_categoriel, sous_controle, controle_motif, controle_depuis)
    values (
      coalesce(p->>'matricule',''), p->>'nom', coalesce(p->>'situation','celibataire'),
      coalesce((p->>'enfants')::int, 0), coalesce(p->>'cnps',''), coalesce(p->>'emploi',''),
      coalesce(p->>'categorie',''),
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
