-- ===========================================================================
-- PaieCI — création de la base Supabase.
-- À coller tel quel dans Supabase → SQL Editor → New query → Run.
--
-- Version MVP : fonctionne avec la clé publique (anon) SANS Supabase Auth.
-- Idempotent — réexécutable. Étape suivante recommandée pour la production :
-- Supabase Auth + colonne owner + politiques RLS par utilisateur.
-- ===========================================================================

-- Nettoyage (permet de relancer le script proprement) -----------------------
drop table if exists heures_supplementaires cascade;
drop table if exists retenues cascade;
drop table if exists primes cascade;
drop table if exists periodes cascade;
drop table if exists employees cascade;
drop table if exists settings cascade;
drop table if exists versements cascade;
drop table if exists audit_log cascade;

-- Profil employeur + paramètres de paie modifiables --------------------------
-- Table à ligne unique (id = 1).
create table settings (
  id int primary key default 1 check (id = 1),
  raison_sociale text not null default 'Mon Entreprise',
  employeur_cnps text not null default '',
  -- Mentions légales complémentaires d'identification employeur, obligatoires
  -- sur le bulletin de paie (RCCM, compte contribuable, branche d'activité).
  rccm text not null default '',
  compte_contribuable text not null default '',
  activite text not null default '',
  -- Logo entreprise imprimé directement dans l'en-tête du bulletin PDF
  -- (data URI base64).
  logo_data_url text not null default '',
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
  -- Catégorie / classification professionnelle (convention collective) —
  -- distincte de l'intitulé de poste (emploi), mention légale du bulletin.
  categorie text not null default '',
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
  -- Compte bancaire / Mobile Money du salarié (RIB, IBAN ou n° Mobile
  -- Money) : facultatif, sert uniquement à générer l'ordre de virement du
  -- livre de paie (voir virementDoc.js) — jamais utilisé dans les calculs.
  compte_bancaire text not null default '',
  -- Adresse email du salarié : facultative, sert uniquement à préparer
  -- l'envoi de son bulletin (voir Bulletins → « Préparer l'email »).
  email text not null default '',
  created_at timestamptz not null default now()
);

-- Numéro de versement CNPS/CMU réel d'un mois donné (bordereau/quittance de
-- paiement effectif), distinct du numéro d'immatriculation employeur fixe
-- (settings.employeur_cnps) : mention légale du bulletin qui n'existe qu'une
-- fois le versement du mois effectué. Une ligne par mois (aaaa-mm-01).
create table versements (
  ym date primary key,
  numero_cnps text not null default '',
  numero_cnam text not null default '',
  date_versement date
);

-- Historique des modifications (qui a changé quoi, quand) : une ligne par
-- création/modification/suppression de salarié, avec un instantané complet
-- avant/après (jsonb) pour permettre un diff lisible côté application. PAS
-- de clé étrangère vers employees (volontaire) : l'historique doit rester
-- consultable même après suppression définitive du salarié concerné.
create table audit_log (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  employee_id uuid,
  employee_nom text not null default '',
  utilisateur text not null default '',
  action text not null default 'update' check (action in ('create','update','delete')),
  avant jsonb,
  apres jsonb
);
create index on audit_log (employee_id);
create index on audit_log (created_at desc);

-- Périodes contractuelles (CDD initial, renouvellements, passage CDI) ---------
create table periodes (
  id uuid primary key default gen_random_uuid(),
  employee_id uuid not null references employees(id) on delete cascade,
  kind text not null default 'cdd' check (kind in ('cdd','cdi')),
  label text not null default '',
  -- Bornes de la période (aaaa-mm-01). fin nulle = CDI ouvert.
  debut date not null,
  fin date,
  -- Jour exact de sortie (1-31, méthode des 30èmes) dans le mois de `fin` :
  -- null = sortie en fin de mois plein (comportement historique) ; renseigné
  -- = le salaire du mois de sortie est proratisé sur les jours travaillés.
  fin_jour smallint check (fin_jour is null or (fin_jour between 1 and 31)),
  salaire_base bigint not null default 0 check (salaire_base >= 0),
  net_cible bigint not null default 0 check (net_cible >= 0),
  transport bigint not null default 0 check (transport >= 0),
  position int not null default 0
);
create index on periodes (employee_id);

-- Primes rattachées à une période (prime de logement, de rendement…). `mois`
-- (aaaa-mm-01) optionnel, même logique que les retenues et heures sup : vide
-- = s'applique à tous les mois de la période (prime mensuelle récurrente) ;
-- renseigné = ce mois précis uniquement (prime exceptionnelle ponctuelle,
-- ex. 13ᵉ mois) — sans quoi elle serait comptée à tort dans l'assiette de
-- l'indemnité de congé payé (règle du 1/12ᵉ) pour les 12 mois de référence.
create table primes (
  id uuid primary key default gen_random_uuid(),
  periode_id uuid not null references periodes(id) on delete cascade,
  label text not null default 'Prime',
  montant bigint not null default 0 check (montant >= 0),
  imposable boolean not null default true,
  mois date,
  position int not null default 0
);
create index on primes (periode_id);

-- Retenues particulières rattachées à une période (avances sur salaire,
-- prêts, oppositions judiciaires…) : déduites du net à payer, mentionnées à
-- part sur le bulletin, distinctes des cotisations/impôts légaux. `mois`
-- (aaaa-mm-01) optionnel : vide = s'applique à tous les mois de la période
-- (ex. opposition récurrente) ; renseigné = ce mois précis uniquement
-- (ex. avance ponctuelle).
create table retenues (
  id uuid primary key default gen_random_uuid(),
  periode_id uuid not null references periodes(id) on delete cascade,
  label text not null default 'Retenue',
  montant bigint not null default 0 check (montant >= 0),
  mois date,
  position int not null default 0
);
create index on retenues (periode_id);

-- Heures supplémentaires rattachées à une période : nombre d'heures et
-- majoration légale (décimal, ex. 0.15 = +15 %), converties en montant via
-- le taux horaire du salaire de base. Même logique de `mois` optionnel que
-- les retenues.
create table heures_supplementaires (
  id uuid primary key default gen_random_uuid(),
  periode_id uuid not null references periodes(id) on delete cascade,
  heures numeric not null default 0 check (heures >= 0),
  majoration numeric not null default 0 check (majoration >= 0),
  mois date,
  position int not null default 0
);
create index on heures_supplementaires (periode_id);

-- Enregistrement atomique d'un salarié et de toutes ses périodes/primes -------
-- en une transaction. `p` est l'objet salarié complet (JSON) tel qu'envoyé par
-- l'application. Les périodes existantes sont remplacées (cascade sur primes).
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

-- Enregistre (upsert) le numéro de versement CNPS/CMU réel d'un mois — voir
-- le commentaire sur la table versements. `ym` = « aaaa-mm ».
create or replace function save_versement(p_ym text, p_numero_cnps text, p_numero_cnam text, p_date_versement text)
returns void language plpgsql as $$
begin
  insert into versements (ym, numero_cnps, numero_cnam, date_versement)
  values (
    (p_ym || '-01')::date,
    coalesce(p_numero_cnps,''),
    coalesce(p_numero_cnam,''),
    nullif(p_date_versement,'')::date
  )
  on conflict (ym) do update set
    numero_cnps = coalesce(p_numero_cnps,''),
    numero_cnam = coalesce(p_numero_cnam,''),
    date_versement = nullif(p_date_versement,'')::date;
end; $$;

-- Sécurité (RLS) ------------------------------------------------------------
-- MVP : RLS activé, clé publique (anon) autorisée à lire/écrire. Suffisant pour
-- une démo / un cabinet de confiance. Étape suivante : Supabase Auth + owner.
alter table settings               enable row level security;
alter table employees              enable row level security;
alter table periodes               enable row level security;
alter table primes                 enable row level security;
alter table retenues               enable row level security;
alter table heures_supplementaires enable row level security;
alter table versements             enable row level security;
alter table audit_log              enable row level security;

drop policy if exists anon_all on settings;
drop policy if exists anon_all on employees;
drop policy if exists anon_all on periodes;
drop policy if exists anon_all on primes;
drop policy if exists anon_all on retenues;
drop policy if exists anon_all on heures_supplementaires;
drop policy if exists anon_all on versements;
drop policy if exists anon_all on audit_log;

create policy anon_all on settings               for all to anon, authenticated using (true) with check (true);
create policy anon_all on employees              for all to anon, authenticated using (true) with check (true);
create policy anon_all on periodes               for all to anon, authenticated using (true) with check (true);
create policy anon_all on primes                 for all to anon, authenticated using (true) with check (true);
create policy anon_all on retenues               for all to anon, authenticated using (true) with check (true);
create policy anon_all on heures_supplementaires for all to anon, authenticated using (true) with check (true);
create policy anon_all on versements             for all to anon, authenticated using (true) with check (true);
create policy anon_all on audit_log               for all to anon, authenticated using (true) with check (true);

-- Les fonctions save_employee / save_versement sont exécutables par la clé publique.
grant execute on function save_employee(jsonb) to anon, authenticated;
grant execute on function save_versement(text, text, text, text) to anon, authenticated;
