-- ===========================================================================
-- Fish-Afric « Gestion des devis » — création de la base Supabase.
-- À coller tel quel dans Supabase → SQL Editor → New query → Run.
--
-- Version MVP : fonctionne avec la clé publique (anon) SANS Supabase Auth.
-- L'auteur de chaque écriture est enregistré comme simple texte (email).
-- Idempotent — réexécutable.
-- ===========================================================================

-- Nettoyage (permet de relancer le script proprement) -----------------------
drop table if exists payments cascade;
drop table if exists devis_lines cascade;
drop table if exists devis cascade;
drop table if exists articles cascade;
drop sequence if exists devis_number_seq;

-- Catalogue d'articles prédéfinis -------------------------------------------
create table articles (
  id uuid primary key default gen_random_uuid(),
  reference text not null default '',
  designation text not null,
  -- Famille : poissons / viandes / frites / laitier (liste ouverte).
  family text not null default '',
  unit_price bigint not null default 0 check (unit_price >= 0),  -- FCFA entier
  is_active boolean not null default true,
  created_at timestamptz not null default now()
);
create index on articles (family);

-- Numérotation automatique et atomique des devis (DV-0001, DV-0002, …) -------
create sequence devis_number_seq;

create table devis (
  id uuid primary key default gen_random_uuid(),
  number text not null unique
    default ('DV-' || lpad(nextval('devis_number_seq')::text, 4, '0')),
  client_name text not null default '',
  client_contact text not null default '',
  status text not null default 'en_cours' check (status in ('en_cours','valide','refuse')),
  delivery_date date,
  delivery_address text not null default '',
  client_signature text not null default '',       -- data URL PNG de la signature
  commercial_signature text not null default '',
  finalized_at timestamptz,
  note text not null default '',
  created_at timestamptz not null default now(),
  author text not null default ''
);

create table devis_lines (
  id uuid primary key default gen_random_uuid(),
  devis_id uuid not null references devis on delete cascade,
  article_ref text not null default '',
  designation text not null,
  unit_price bigint not null check (unit_price >= 0),
  quantity numeric(12,2) not null check (quantity > 0),
  amount bigint not null check (amount >= 0)   -- figé = round(unit_price × quantity)
);
create index on devis_lines (devis_id);

create table payments (
  id uuid primary key default gen_random_uuid(),
  devis_id uuid not null references devis on delete cascade,
  type text not null check (type in ('acompte','total')),
  amount bigint not null check (amount >= 0),
  client_signature text not null default '',
  note text not null default '',
  created_at timestamptz not null default now(),
  author text not null default ''
);
create index on payments (devis_id);

-- Création atomique d'un devis : numéro (séquence) + lignes en une -----------
-- transaction. p_lines est un tableau JSON de {articleRef, designation,
-- unitPrice, quantity}. Le montant de chaque ligne est figé côté serveur.
create or replace function create_devis(
  p_client_name text, p_client_contact text, p_note text, p_author text, p_lines jsonb
) returns jsonb language plpgsql as $$
declare v_id uuid; v_number text; v_line jsonb;
begin
  if p_lines is null or jsonb_array_length(p_lines) = 0 then
    raise exception 'Un devis doit contenir au moins une ligne';
  end if;
  insert into devis (client_name, client_contact, note, author)
  values (coalesce(p_client_name,''), coalesce(p_client_contact,''), coalesce(p_note,''), coalesce(p_author,''))
  returning id, number into v_id, v_number;
  for v_line in select * from jsonb_array_elements(p_lines)
  loop
    insert into devis_lines (devis_id, article_ref, designation, unit_price, quantity, amount)
    values (
      v_id, coalesce(v_line->>'articleRef',''), v_line->>'designation',
      (v_line->>'unitPrice')::bigint, (v_line->>'quantity')::numeric,
      round((v_line->>'unitPrice')::numeric * (v_line->>'quantity')::numeric)
    );
  end loop;
  return jsonb_build_object('id', v_id, 'number', v_number);
end; $$;

-- Mise à jour d'un devis « en cours » : infos client + remplacement des ------
-- lignes, en une transaction. Refuse un devis déjà validé/refusé.
create or replace function update_devis(
  p_devis uuid, p_client_name text, p_client_contact text, p_note text, p_lines jsonb
) returns void language plpgsql as $$
declare v_status text; v_line jsonb;
begin
  select status into v_status from devis where id = p_devis for update;
  if not found then raise exception 'Devis introuvable'; end if;
  if v_status <> 'en_cours' then raise exception 'Devis verrouillé (déjà validé ou refusé)'; end if;
  if p_lines is null or jsonb_array_length(p_lines) = 0 then
    raise exception 'Un devis doit contenir au moins une ligne';
  end if;
  update devis set client_name = coalesce(p_client_name,''),
    client_contact = coalesce(p_client_contact,''), note = coalesce(p_note,'')
  where id = p_devis;
  delete from devis_lines where devis_id = p_devis;
  for v_line in select * from jsonb_array_elements(p_lines)
  loop
    insert into devis_lines (devis_id, article_ref, designation, unit_price, quantity, amount)
    values (
      p_devis, coalesce(v_line->>'articleRef',''), v_line->>'designation',
      (v_line->>'unitPrice')::bigint, (v_line->>'quantity')::numeric,
      round((v_line->>'unitPrice')::numeric * (v_line->>'quantity')::numeric)
    );
  end loop;
end; $$;

-- Sécurité (RLS) ------------------------------------------------------------
-- MVP : RLS activé, clé publique (anon) autorisée à lire/écrire. Suffisant
-- pour une démo / un petit atelier de confiance. Étape suivante : Supabase
-- Auth + restriction par rôle (Responsable / Commercial).
alter table articles    enable row level security;
alter table devis       enable row level security;
alter table devis_lines enable row level security;
alter table payments    enable row level security;

drop policy if exists anon_all on articles;
drop policy if exists anon_all on devis;
drop policy if exists anon_all on devis_lines;
drop policy if exists anon_all on payments;

create policy anon_all on articles    for all to anon, authenticated using (true) with check (true);
create policy anon_all on devis        for all to anon, authenticated using (true) with check (true);
create policy anon_all on devis_lines  for all to anon, authenticated using (true) with check (true);
create policy anon_all on payments     for all to anon, authenticated using (true) with check (true);
