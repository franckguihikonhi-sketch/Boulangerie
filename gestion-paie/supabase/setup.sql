-- ===========================================================================
-- PaieCI — création de la base Supabase.
-- À coller tel quel dans Supabase → SQL Editor → New query → Run.
--
-- Version MVP : fonctionne avec la clé publique (anon) SANS Supabase Auth.
-- Idempotent — réexécutable. Étape suivante recommandée pour la production :
-- Supabase Auth + colonne owner + politiques RLS par utilisateur.
-- ===========================================================================

-- Nettoyage (permet de relancer le script proprement) -----------------------
drop table if exists primes cascade;
drop table if exists periodes cascade;
drop table if exists employees cascade;
drop table if exists settings cascade;

-- Profil employeur + paramètres de paie modifiables --------------------------
-- Table à ligne unique (id = 1).
create table settings (
  id int primary key default 1 check (id = 1),
  raison_sociale text not null default 'Mon Entreprise',
  employeur_cnps text not null default '',
  adresse text not null default '',
  mode_paiement text not null default 'Virement',
  -- Taux d'accident du travail notifié par la CNPS (2 % à 5 %).
  taux_accident_travail numeric not null default 0.05 check (taux_accident_travail >= 0 and taux_accident_travail <= 0.10),
  -- Plafond de la prime de transport exonérée (FCFA entier).
  transport_exonere bigint not null default 30000 check (transport_exonere >= 0),
  updated_at timestamptz not null default now()
);
insert into settings (id) values (1) on conflict (id) do nothing;

-- Salariés -------------------------------------------------------------------
create table employees (
  id uuid primary key default gen_random_uuid(),
  matricule text not null default '',
  nom text not null,
  situation text not null default 'celibataire'
    check (situation in ('celibataire','marie','divorce','veuf')),
  enfants int not null default 0 check (enfants >= 0),
  cnps text not null default '',
  emploi text not null default '',
  -- Salarié expatrié : déclenche l'impôt sur salaires patronal « expatriés »
  -- (11,5 %) en plus de la part locale (1,2 %).
  expatrie boolean not null default false,
  -- Date d'embauche : base du calcul de l'ancienneté.
  date_embauche date,
  -- Salaire catégoriel (minimum conventionnel) : assiette de la prime
  -- d'ancienneté. FCFA entier.
  salaire_categoriel bigint not null default 0 check (salaire_categoriel >= 0),
  -- Marquage « sous contrôle » : signale un salarié dont le dossier doit
  -- faire l'objet d'une vérification approfondie avant traitement (purement
  -- indicatif — motif et date facultatifs).
  sous_controle boolean not null default false,
  controle_motif text not null default '',
  controle_depuis date,
  created_at timestamptz not null default now()
);

-- Périodes contractuelles (CDD initial, renouvellements, passage CDI) ---------
create table periodes (
  id uuid primary key default gen_random_uuid(),
  employee_id uuid not null references employees(id) on delete cascade,
  kind text not null default 'cdd' check (kind in ('cdd','cdi')),
  label text not null default '',
  -- Bornes de la période (aaaa-mm-01). fin nulle = CDI ouvert.
  debut date not null,
  fin date,
  salaire_base bigint not null default 0 check (salaire_base >= 0),
  net_cible bigint not null default 0 check (net_cible >= 0),
  transport bigint not null default 0 check (transport >= 0),
  position int not null default 0
);
create index on periodes (employee_id);

-- Primes rattachées à une période -------------------------------------------
create table primes (
  id uuid primary key default gen_random_uuid(),
  periode_id uuid not null references periodes(id) on delete cascade,
  label text not null default 'Prime',
  montant bigint not null default 0 check (montant >= 0),
  imposable boolean not null default true,
  position int not null default 0
);
create index on primes (periode_id);

-- Enregistrement atomique d'un salarié et de toutes ses périodes/primes -------
-- en une transaction. `p` est l'objet salarié complet (JSON) tel qu'envoyé par
-- l'application. Les périodes existantes sont remplacées (cascade sur primes).
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

-- Sécurité (RLS) ------------------------------------------------------------
-- MVP : RLS activé, clé publique (anon) autorisée à lire/écrire. Suffisant pour
-- une démo / un cabinet de confiance. Étape suivante : Supabase Auth + owner.
alter table settings  enable row level security;
alter table employees enable row level security;
alter table periodes  enable row level security;
alter table primes    enable row level security;

drop policy if exists anon_all on settings;
drop policy if exists anon_all on employees;
drop policy if exists anon_all on periodes;
drop policy if exists anon_all on primes;

create policy anon_all on settings  for all to anon, authenticated using (true) with check (true);
create policy anon_all on employees for all to anon, authenticated using (true) with check (true);
create policy anon_all on periodes  for all to anon, authenticated using (true) with check (true);
create policy anon_all on primes    for all to anon, authenticated using (true) with check (true);

-- La fonction save_employee est exécutable par la clé publique.
grant execute on function save_employee(jsonb) to anon, authenticated;
