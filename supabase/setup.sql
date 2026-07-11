-- ===========================================================================
-- Boulange ERP — Script de création de la base Supabase (à coller tel quel
-- dans Supabase → SQL Editor → New query → Run).
--
-- Version MVP : fonctionne avec la clé publique (anon) SANS Supabase Auth.
-- L'auteur de chaque écriture est enregistré comme simple texte (email).
-- Sécurité : voir la note en bas de fichier. Idempotent — réexécutable.
-- ===========================================================================

-- Nettoyage (permet de relancer le script proprement) -----------------------
drop table if exists production_lines cascade;
drop table if exists stock_movements cascade;
drop table if exists productions cascade;
drop table if exists purchases cascade;
drop table if exists sales cascade;
drop table if exists recipes cascade;
drop table if exists products cascade;
drop table if exists ingredients cascade;
-- Note : on NE supprime PAS sage_entries pour ne pas perdre les écritures
-- saisies si le script est relancé ; sa création ci-dessous est idempotente.

-- Tables --------------------------------------------------------------------
create table ingredients (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  type text not null check (type in ('matiere_premiere','charge_utilite')),
  base_unit text not null check (base_unit in ('g','ml','unite')),
  min_threshold numeric(12,2) not null default 0 check (min_threshold >= 0),
  unit_cost bigint not null default 0 check (unit_cost >= 0),  -- FCFA entier
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table products (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  category text not null check (category in ('pain','viennoiserie','patisserie','boisson','autre')),
  selling_price bigint not null default 0 check (selling_price >= 0),
  is_active boolean not null default true,
  created_at timestamptz not null default now()
);

create table recipes (
  id uuid primary key default gen_random_uuid(),
  product_id uuid not null references products on delete cascade,
  ingredient_id uuid not null references ingredients on delete restrict,
  qty_base numeric(12,2) not null check (qty_base > 0),
  unique (product_id, ingredient_id)
);

create table purchases (
  id uuid primary key default gen_random_uuid(),
  ingredient_id uuid not null references ingredients on delete restrict,
  qty_base numeric(12,2) not null check (qty_base > 0),
  unit_cost bigint not null check (unit_cost >= 0),
  total_cost bigint not null check (total_cost >= 0),
  supplier text not null default '',
  note text not null default '',
  purchased_at timestamptz not null default now(),
  idempotency_key uuid not null unique,   -- anti-doublon (anomalies 4,5)
  author text not null default ''
);

create table productions (
  id uuid primary key default gen_random_uuid(),
  product_id uuid not null references products on delete restrict,
  quantity_produced integer not null check (quantity_produced > 0),
  note text not null default '',
  produced_at timestamptz not null default now(),
  total_cost bigint not null check (total_cost >= 0),  -- figé (anomalie 7)
  idempotency_key uuid not null unique,
  author text not null default ''
);

create table production_lines (
  id uuid primary key default gen_random_uuid(),
  production_id uuid not null references productions on delete cascade,
  ingredient_id uuid not null references ingredients on delete restrict,
  qty_base numeric(12,2) not null check (qty_base > 0),
  cost bigint not null check (cost >= 0)
);

create table stock_movements (
  id uuid primary key default gen_random_uuid(),
  ingredient_id uuid not null references ingredients on delete restrict,
  change_base numeric(12,2) not null,   -- source de vérité du stock
  reason text not null check (reason in ('achat','production','ajustement','perte')),
  reference_id uuid,
  note text not null default '',
  created_at timestamptz not null default now(),
  author text not null default ''
);
create index on stock_movements (ingredient_id, created_at);

create table sales (
  id uuid primary key default gen_random_uuid(),
  product_id uuid not null references products on delete restrict,
  quantity integer not null check (quantity > 0),
  unit_price bigint not null check (unit_price >= 0),
  total bigint not null check (total >= 0),
  client text not null default '',
  note text not null default '',
  sold_at timestamptz not null default now(),
  idempotency_key uuid not null unique,
  author text not null default ''
);

-- Écritures comptables saisies pour l'export SAGE ---------------------------
-- Saisie manuelle des écritures (journal, date de pièce, compte, libellé,
-- débit, crédit) destinées au fichier d'import SAGE 100 Comptabilité.
-- Montants en FCFA entiers, comme le reste de l'application.
-- Création idempotente : conserve les écritures déjà saisies.
create table if not exists sage_entries (
  id uuid primary key default gen_random_uuid(),
  journal text not null,                         -- code journal (VT, AC, OD…)
  piece_date date not null,                       -- date de pièce
  account text not null,                          -- n° compte général
  label text not null default '',                 -- libellé écriture
  debit bigint not null default 0 check (debit >= 0),
  credit bigint not null default 0 check (credit >= 0),
  created_at timestamptz not null default now(),  -- ordre de saisie
  author text not null default ''
);
create index if not exists sage_entries_created_idx on sage_entries (created_at);

-- Stock courant d'un ingrédient = somme de ses mouvements --------------------
create or replace function ingredient_current_qty(p_ingredient uuid)
returns numeric language sql stable as $$
  select coalesce(sum(change_base), 0) from stock_movements where ingredient_id = p_ingredient;
$$;

-- Achat atomique : ligne + mouvement + recalcul du CMP (arrondi entier) ------
create or replace function record_purchase(
  p_ingredient uuid, p_qty_base numeric, p_unit_cost bigint,
  p_supplier text, p_note text, p_idempotency_key uuid, p_author text
) returns uuid language plpgsql as $$
declare
  v_existing uuid; v_id uuid; v_factor numeric; v_before numeric;
  v_value_before numeric; v_bought numeric; v_ing ingredients%rowtype;
begin
  select id into v_existing from purchases where idempotency_key = p_idempotency_key;
  if found then return v_existing; end if;
  select * into v_ing from ingredients where id = p_ingredient for update;
  if not found then raise exception 'Ingrédient introuvable'; end if;
  v_factor := case when v_ing.base_unit = 'unite' then 1 else 1000 end;
  v_before := ingredient_current_qty(p_ingredient) / v_factor;
  v_value_before := v_before * v_ing.unit_cost;
  v_bought := p_qty_base / v_factor;
  update ingredients set
    unit_cost = case when v_before + v_bought > 0
      then round((v_value_before + v_bought * p_unit_cost) / (v_before + v_bought))
      else p_unit_cost end,
    updated_at = now()
  where id = p_ingredient;
  insert into purchases (ingredient_id, qty_base, unit_cost, total_cost, supplier, note, idempotency_key, author)
  values (p_ingredient, p_qty_base, p_unit_cost, round(v_bought * p_unit_cost), coalesce(p_supplier,''), coalesce(p_note,''), p_idempotency_key, coalesce(p_author,''))
  returning id into v_id;
  insert into stock_movements (ingredient_id, change_base, reason, reference_id, author)
  values (p_ingredient, p_qty_base, 'achat', v_id, coalesce(p_author,''));
  return v_id;
end; $$;

-- Suppression d'un achat : bloquée si stock déjà consommé (anomalie 12) ------
create or replace function delete_purchase(p_purchase uuid)
returns void language plpgsql as $$
declare v_p purchases%rowtype;
begin
  select * into v_p from purchases where id = p_purchase for update;
  if not found then raise exception 'Achat introuvable'; end if;
  if ingredient_current_qty(v_p.ingredient_id) - v_p.qty_base < 0 then
    raise exception 'Stock déjà consommé en production, suppression impossible';
  end if;
  delete from stock_movements where reason = 'achat' and reference_id = p_purchase;
  delete from purchases where id = p_purchase;
end; $$;

-- Production atomique : vérif stock, coût figé, mouvements, idempotence ------
create or replace function record_production(
  p_product uuid, p_quantity integer, p_note text, p_idempotency_key uuid, p_author text
) returns uuid language plpgsql as $$
declare
  v_existing uuid; v_id uuid; v_total bigint := 0; v_line record;
  v_needed numeric; v_available numeric; v_factor numeric; v_cost bigint;
begin
  select id into v_existing from productions where idempotency_key = p_idempotency_key;
  if found then return v_existing; end if;
  if not exists (select 1 from recipes where product_id = p_product) then
    raise exception 'Ce produit n''a pas de recette';
  end if;
  for v_line in
    select r.qty_base, i.* from recipes r join ingredients i on i.id = r.ingredient_id
    where r.product_id = p_product order by i.name
  loop
    v_needed := v_line.qty_base * p_quantity;
    v_available := ingredient_current_qty(v_line.id);
    if v_needed > v_available then
      raise exception 'Stock insuffisant : % — il manque %', v_line.name, round(v_needed - v_available, 2);
    end if;
  end loop;
  insert into productions (product_id, quantity_produced, note, total_cost, idempotency_key, author)
  values (p_product, p_quantity, coalesce(p_note,''), 0, p_idempotency_key, coalesce(p_author,''))
  returning id into v_id;
  for v_line in
    select r.qty_base, i.* from recipes r join ingredients i on i.id = r.ingredient_id
    where r.product_id = p_product
  loop
    v_factor := case when v_line.base_unit = 'unite' then 1 else 1000 end;
    v_needed := v_line.qty_base * p_quantity;
    v_cost := round((v_needed / v_factor) * v_line.unit_cost);
    v_total := v_total + v_cost;
    insert into production_lines (production_id, ingredient_id, qty_base, cost)
    values (v_id, v_line.id, v_needed, v_cost);
    insert into stock_movements (ingredient_id, change_base, reason, reference_id, author)
    values (v_line.id, -v_needed, 'production', v_id, coalesce(p_author,''));
  end loop;
  update productions set total_cost = v_total where id = v_id;
  return v_id;
end; $$;

-- Vente : ne décrémente que le stock de produits finis -----------------------
create or replace function record_sale(
  p_product uuid, p_quantity integer, p_unit_price bigint,
  p_client text, p_note text, p_idempotency_key uuid, p_author text
) returns uuid language plpgsql as $$
declare v_existing uuid; v_id uuid; v_stock integer;
begin
  select id into v_existing from sales where idempotency_key = p_idempotency_key;
  if found then return v_existing; end if;
  select coalesce((select sum(quantity_produced) from productions where product_id = p_product),0)
       - coalesce((select sum(quantity) from sales where product_id = p_product),0)
  into v_stock;
  if v_stock < p_quantity then raise exception 'Stock de produits finis insuffisant'; end if;
  insert into sales (product_id, quantity, unit_price, total, client, note, idempotency_key, author)
  values (p_product, p_quantity, p_unit_price, p_unit_price * p_quantity, coalesce(p_client,''), coalesce(p_note,''), p_idempotency_key, coalesce(p_author,''))
  returning id into v_id;
  return v_id;
end; $$;

-- Sécurité (RLS) ------------------------------------------------------------
-- MVP : on active RLS et on autorise la clé publique (anon) à lire/écrire.
-- ⚠️ Cela signifie que quiconque possède la clé publique peut accéder aux
--    données. Suffisant pour une démo / un petit atelier de confiance.
--    Étape suivante recommandée pour la production : activer Supabase Auth
--    et restreindre par rôle (admin/opérateur) — le schéma le prévoit déjà.
-- (Lignes simples, sans « dollar-quoting », pour un copier-coller sans risque.)
alter table ingredients      enable row level security;
alter table products         enable row level security;
alter table recipes          enable row level security;
alter table purchases        enable row level security;
alter table productions      enable row level security;
alter table production_lines enable row level security;
alter table stock_movements  enable row level security;
alter table sales            enable row level security;
alter table sage_entries     enable row level security;

drop policy if exists anon_all on ingredients;
drop policy if exists anon_all on products;
drop policy if exists anon_all on recipes;
drop policy if exists anon_all on purchases;
drop policy if exists anon_all on productions;
drop policy if exists anon_all on production_lines;
drop policy if exists anon_all on stock_movements;
drop policy if exists anon_all on sales;
drop policy if exists anon_all on sage_entries;

create policy anon_all on ingredients      for all to anon, authenticated using (true) with check (true);
create policy anon_all on products         for all to anon, authenticated using (true) with check (true);
create policy anon_all on recipes          for all to anon, authenticated using (true) with check (true);
create policy anon_all on purchases        for all to anon, authenticated using (true) with check (true);
create policy anon_all on productions      for all to anon, authenticated using (true) with check (true);
create policy anon_all on production_lines for all to anon, authenticated using (true) with check (true);
create policy anon_all on stock_movements  for all to anon, authenticated using (true) with check (true);
create policy anon_all on sales            for all to anon, authenticated using (true) with check (true);
create policy anon_all on sage_entries     for all to anon, authenticated using (true) with check (true);
