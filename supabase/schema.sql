-- ===========================================================================
-- Boulange ERP — Schéma PostgreSQL cible (Supabase)
-- Section 4 du cahier des charges V2.
--
-- Les garde-fous structurels qui éliminent les classes d'anomalies :
--   * NUMERIC/BIGINT entiers pour les FCFA  -> anomalies n°1, 3
--   * UNIQUE(idempotency_key)               -> anomalies n°4, 5
--   * FK + transactions (fonctions SQL)     -> anomalie n°12
--   * ENUM pour les catégories              -> anomalie n°10
--   * current_quantity dérivé des mouvements-> anomalie n°2
-- ===========================================================================

create type ingredient_type as enum ('matiere_premiere', 'charge_utilite');
create type base_unit as enum ('g', 'ml', 'unite');
-- Liste fermée, jamais traduite automatiquement (anomalie n°10).
create type product_category as enum ('pain', 'viennoiserie', 'patisserie', 'boisson', 'autre');
create type movement_reason as enum ('achat', 'production', 'ajustement', 'perte');
create type user_role as enum ('admin', 'operateur');

-- ---------------------------------------------------------------------------
create table profiles (
  id uuid primary key references auth.users on delete cascade,
  name text not null,
  role user_role not null default 'operateur',
  created_at timestamptz not null default now()
);

create table ingredients (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  type ingredient_type not null,
  base_unit base_unit not null,
  min_threshold numeric(12,2) not null default 0 check (min_threshold >= 0),
  -- CMP en FCFA par unité de stock (kg / L / unité) : toujours un ENTIER.
  unit_cost bigint not null default 0 check (unit_cost >= 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table products (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  category product_category not null,
  selling_price bigint not null default 0 check (selling_price >= 0),
  is_active boolean not null default true,
  created_at timestamptz not null default now()
);

create table recipes (
  id uuid primary key default gen_random_uuid(),
  product_id uuid not null references products on delete cascade,
  ingredient_id uuid not null references ingredients on delete restrict,
  -- Quantité dans l'unité de BASE de l'ingrédient (g / ml / unité).
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
  idempotency_key uuid not null unique,
  author uuid references profiles
);

create table productions (
  id uuid primary key default gen_random_uuid(),
  product_id uuid not null references products on delete restrict,
  quantity_produced integer not null check (quantity_produced > 0),
  note text not null default '',
  produced_at timestamptz not null default now(),
  -- Figé à la validation, JAMAIS recalculé rétroactivement (anomalie n°7).
  total_cost bigint not null check (total_cost >= 0),
  idempotency_key uuid not null unique,
  author uuid references profiles
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
  change_base numeric(12,2) not null,
  reason movement_reason not null,
  reference_id uuid,
  note text not null default '',
  created_at timestamptz not null default now(),
  author uuid references profiles
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
  author uuid references profiles
);

-- ---------------------------------------------------------------------------
-- Source de vérité : le stock courant est TOUJOURS la somme des mouvements.
create or replace function ingredient_current_qty(p_ingredient uuid)
returns numeric language sql stable as $$
  select coalesce(sum(change_base), 0)
  from stock_movements
  where ingredient_id = p_ingredient;
$$;

-- ---------------------------------------------------------------------------
-- Achat atomique : ligne d'achat + mouvement + recalcul du CMP (arrondi
-- entier), avec idempotence. À appeler via supabase.rpc('record_purchase',…).
create or replace function record_purchase(
  p_ingredient uuid,
  p_qty_base numeric,
  p_unit_cost bigint,
  p_supplier text,
  p_note text,
  p_idempotency_key uuid
) returns uuid language plpgsql as $$
declare
  v_existing uuid;
  v_id uuid;
  v_factor numeric;
  v_before numeric;
  v_value_before numeric;
  v_bought numeric;
  v_ing ingredients%rowtype;
begin
  select id into v_existing from purchases where idempotency_key = p_idempotency_key;
  if found then return v_existing; end if;

  select * into v_ing from ingredients where id = p_ingredient for update;
  if not found then raise exception 'ingredient introuvable'; end if;

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
  values (p_ingredient, p_qty_base, p_unit_cost, round(v_bought * p_unit_cost), coalesce(p_supplier, ''), coalesce(p_note, ''), p_idempotency_key, auth.uid())
  returning id into v_id;

  insert into stock_movements (ingredient_id, change_base, reason, reference_id, author)
  values (p_ingredient, p_qty_base, 'achat', v_id, auth.uid());

  return v_id;
end;
$$;

-- ---------------------------------------------------------------------------
-- Suppression d'achat (anomalie n°12) : bloque si le stock a déjà été
-- consommé, sinon retire achat + mouvement dans la même transaction.
create or replace function delete_purchase(p_purchase uuid)
returns void language plpgsql as $$
declare
  v_p purchases%rowtype;
begin
  select * into v_p from purchases where id = p_purchase for update;
  if not found then raise exception 'achat introuvable'; end if;
  if ingredient_current_qty(v_p.ingredient_id) - v_p.qty_base < 0 then
    raise exception 'Stock déjà consommé en production, suppression impossible';
  end if;
  delete from stock_movements where reason = 'achat' and reference_id = p_purchase;
  delete from purchases where id = p_purchase;
end;
$$;

-- ---------------------------------------------------------------------------
-- Production atomique : vérification de stock, coût figé au CMP courant,
-- mouvements négatifs, idempotence (anomalies n°4, 5, 7, 8).
create or replace function record_production(
  p_product uuid,
  p_quantity integer,
  p_note text,
  p_idempotency_key uuid
) returns uuid language plpgsql as $$
declare
  v_existing uuid;
  v_id uuid;
  v_total bigint := 0;
  v_line record;
  v_needed numeric;
  v_available numeric;
  v_factor numeric;
  v_cost bigint;
begin
  select id into v_existing from productions where idempotency_key = p_idempotency_key;
  if found then return v_existing; end if;

  if not exists (select 1 from recipes where product_id = p_product) then
    raise exception 'Ce produit n''a pas de recette';
  end if;

  -- Vérification de stock : indique précisément lequel manque et de combien.
  for v_line in
    select r.qty_base, i.* from recipes r join ingredients i on i.id = r.ingredient_id
    where r.product_id = p_product
    order by i.name
  loop
    v_needed := v_line.qty_base * p_quantity;
    v_available := ingredient_current_qty(v_line.id);
    if v_needed > v_available then
      raise exception 'Stock insuffisant : % — il manque % %',
        v_line.name, round(v_needed - v_available, 2), v_line.base_unit;
    end if;
  end loop;

  insert into productions (product_id, quantity_produced, note, total_cost, idempotency_key, author)
  values (p_product, p_quantity, coalesce(p_note, ''), 0, p_idempotency_key, auth.uid())
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
    values (v_line.id, -v_needed, 'production', v_id, auth.uid());
  end loop;

  update productions set total_cost = v_total where id = v_id;
  return v_id;
end;
$$;

-- ---------------------------------------------------------------------------
-- Vente : ne décrémente que le stock de produits finis (produit − vendu).
create or replace function record_sale(
  p_product uuid,
  p_quantity integer,
  p_unit_price bigint,
  p_client text,
  p_note text,
  p_idempotency_key uuid
) returns uuid language plpgsql as $$
declare
  v_existing uuid;
  v_id uuid;
  v_stock integer;
begin
  select id into v_existing from sales where idempotency_key = p_idempotency_key;
  if found then return v_existing; end if;

  select coalesce((select sum(quantity_produced) from productions where product_id = p_product), 0)
       - coalesce((select sum(quantity) from sales where product_id = p_product), 0)
  into v_stock;
  if v_stock < p_quantity then
    raise exception 'Stock de produits finis insuffisant';
  end if;

  insert into sales (product_id, quantity, unit_price, total, client, note, idempotency_key, author)
  values (p_product, p_quantity, p_unit_price, p_unit_price * p_quantity,
          coalesce(p_client, ''), coalesce(p_note, ''), p_idempotency_key, auth.uid())
  returning id into v_id;
  return v_id;
end;
$$;

-- ---------------------------------------------------------------------------
-- Row Level Security : lecture pour tout utilisateur authentifié ; écritures
-- via les fonctions ci-dessus ; suppressions et rapports réservés aux admins
-- (à affiner selon les politiques exactes souhaitées).
alter table profiles enable row level security;
alter table ingredients enable row level security;
alter table products enable row level security;
alter table recipes enable row level security;
alter table purchases enable row level security;
alter table productions enable row level security;
alter table production_lines enable row level security;
alter table stock_movements enable row level security;
alter table sales enable row level security;

create policy "read own profile" on profiles for select using (auth.uid() = id);
create policy "authenticated read" on ingredients for select using (auth.role() = 'authenticated');
create policy "authenticated read" on products for select using (auth.role() = 'authenticated');
create policy "authenticated read" on recipes for select using (auth.role() = 'authenticated');
create policy "authenticated read" on productions for select using (auth.role() = 'authenticated');
create policy "authenticated read" on production_lines for select using (auth.role() = 'authenticated');
create policy "authenticated read" on sales for select using (auth.role() = 'authenticated');

create or replace function is_admin() returns boolean language sql stable as $$
  select exists (select 1 from profiles where id = auth.uid() and role = 'admin');
$$;

-- Les coûts d'achat et mouvements ne sont visibles que des admins (5.8).
create policy "admin read" on purchases for select using (is_admin());
create policy "admin read" on stock_movements for select using (is_admin());
