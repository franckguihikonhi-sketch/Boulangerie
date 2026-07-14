-- ===========================================================================
-- PaieCI — schéma PostgreSQL cible (Supabase).
-- À coller dans Supabase → SQL Editor → New query → Run.
-- Idempotent — réexécutable. Version MVP fonctionnant avec la clé publique
-- (anon) SANS Supabase Auth ; activez ensuite l'Auth + RLS pour la production.
-- ===========================================================================

drop table if exists primes cascade;
drop table if exists periodes cascade;
drop table if exists employees cascade;
drop table if exists settings cascade;

-- Profil employeur + paramètres de paie modifiables --------------------------
create table settings (
  id uuid primary key default gen_random_uuid(),
  raison_sociale text not null default 'Mon Entreprise',
  employeur_cnps text not null default '',
  adresse text not null default '',
  -- Mode de règlement affiché sur le bulletin.
  mode_paiement text not null default 'Virement',
  -- Taux d'accident du travail notifié par la CNPS (2 % à 5 %).
  taux_accident_travail numeric not null default 0.03 check (taux_accident_travail >= 0 and taux_accident_travail <= 0.10),
  -- Plafond de la prime de transport exonérée (FCFA entier).
  transport_exonere bigint not null default 30000 check (transport_exonere >= 0),
  updated_at timestamptz not null default now()
);

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
  -- (11,5 %) en lieu et place de la seule part locale (1,2 %).
  expatrie boolean not null default false,
  -- Date d'embauche : base du calcul de l'ancienneté.
  date_embauche date,
  -- Salaire catégoriel (minimum conventionnel) : assiette de la prime
  -- d'ancienneté. FCFA entier.
  salaire_categoriel bigint not null default 0 check (salaire_categoriel >= 0),
  created_at timestamptz not null default now()
);

-- Périodes contractuelles (CDD initial, renouvellements, passage CDI) ---------
create table periodes (
  id uuid primary key default gen_random_uuid(),
  employee_id uuid not null references employees(id) on delete cascade,
  kind text not null default 'cdd' check (kind in ('cdd','cdi')),
  label text not null default '',
  -- Bornes de la période, au format « aaaa-mm-01 » ; fin nulle = CDI ouvert.
  debut date not null,
  fin date,
  salaire_base bigint not null default 0 check (salaire_base >= 0),   -- FCFA
  net_cible bigint not null default 0 check (net_cible >= 0),         -- FCFA
  transport bigint not null default 0 check (transport >= 0),         -- FCFA
  position int not null default 0
);
create index on periodes (employee_id);

-- Primes rattachées à une période -------------------------------------------
create table primes (
  id uuid primary key default gen_random_uuid(),
  periode_id uuid not null references periodes(id) on delete cascade,
  label text not null default 'Prime',
  montant bigint not null default 0 check (montant >= 0),  -- FCFA entier
  imposable boolean not null default true
);
create index on primes (periode_id);

-- Une seule ligne de paramètres au départ.
insert into settings (raison_sociale) values ('Mon Entreprise');

-- ---------------------------------------------------------------------------
-- Pour la production : activer Supabase Auth, ajouter une colonne owner
-- (uuid references auth.users) sur employees/settings, puis des policies RLS
-- restreignant chaque enregistrement à son propriétaire. Le calcul de paie
-- reste côté client (module lib/payroll.js), aucune donnée sensible ne
-- transitant hors de la base.
-- ---------------------------------------------------------------------------
