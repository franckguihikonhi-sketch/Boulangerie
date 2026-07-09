-- ===========================================================================
-- Boulange ERP — SCHÉMA MULTI-CLIENTS (SaaS)
-- ---------------------------------------------------------------------------
-- Chaque boulangerie = un « locataire » (tenant). Les utilisateurs se
-- connectent via Supabase Auth (email + mot de passe). La sécurité au niveau
-- des lignes (RLS) garantit que chaque utilisateur ne voit QUE les données de
-- SA boulangerie — isolation totale entre clients.
--
-- À exécuter dans un projet Supabase DÉDIÉ au SaaS (SQL Editor → Run).
-- Idempotent tant que les tables n'existent pas déjà avec d'autres colonnes.
-- ===========================================================================

-- 1) Boulangeries (locataires) et profils utilisateurs -----------------------

create table if not exists public.bakeries (
  id         uuid primary key default gen_random_uuid(),
  name       text not null,
  active     boolean not null default true,      -- abonnement actif ?
  created_at timestamptz not null default now()
);

create table if not exists public.profiles (
  id         uuid primary key references auth.users on delete cascade,
  bakery_id  uuid not null references public.bakeries on delete cascade,
  full_name  text not null default '',
  role       text not null default 'operateur' check (role in ('admin','operateur')),
  created_at timestamptz not null default now()
);

-- Renvoie la boulangerie de l'utilisateur connecté (clé de l'isolation).
create or replace function public.current_bakery()
returns uuid language sql stable security definer set search_path = public as $fn$
  select bakery_id from public.profiles where id = auth.uid();
$fn$;

-- Inscription : crée une boulangerie + le profil administrateur pour le
-- compte qui vient de s'enregistrer. Appelé une fois après la création du
-- compte (Supabase Auth). Réappel = renvoie la boulangerie existante.
create or replace function public.create_bakery(p_name text)
returns uuid language plpgsql security definer set search_path = public as $fn$
declare v_id uuid;
begin
  if auth.uid() is null then raise exception 'Non authentifié'; end if;
  select bakery_id into v_id from public.profiles where id = auth.uid();
  if found then return v_id; end if;
  insert into public.bakeries (name) values (coalesce(nullif(trim(p_name),''), 'Ma boulangerie'))
    returning id into v_id;
  insert into public.profiles (id, bakery_id, full_name, role)
    values (auth.uid(), v_id, '', 'admin');
  return v_id;
end; $fn$;

-- 2) Tables métier (chacune porte bakery_id) --------------------------------

create table if not exists public.ingredients (
  id uuid primary key default gen_random_uuid(),
  bakery_id uuid not null references public.bakeries on delete cascade,
  name text not null,
  type text not null check (type in ('matiere_premiere','charge_utilite')),
  base_unit text not null check (base_unit in ('g','ml','unite')),
  min_threshold numeric(12,2) not null default 0 check (min_threshold >= 0),
  unit_cost bigint not null default 0 check (unit_cost >= 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.products (
  id uuid primary key default gen_random_uuid(),
  bakery_id uuid not null references public.bakeries on delete cascade,
  name text not null,
  category text not null check (category in ('pain','viennoiserie','patisserie','boisson','autre')),
  selling_price bigint not null default 0 check (selling_price >= 0),
  is_active boolean not null default true,
  created_at timestamptz not null default now()
);

create table if not exists public.recipes (
  id uuid primary key default gen_random_uuid(),
  bakery_id uuid not null references public.bakeries on delete cascade,
  product_id uuid not null references public.products on delete cascade,
  ingredient_id uuid not null references public.ingredients on delete restrict,
  qty_base numeric(12,2) not null check (qty_base > 0),
  unique (product_id, ingredient_id)
);

create table if not exists public.purchases (
  id uuid primary key default gen_random_uuid(),
  bakery_id uuid not null references public.bakeries on delete cascade,
  ingredient_id uuid not null references public.ingredients on delete restrict,
  qty_base numeric(12,2) not null check (qty_base > 0),
  unit_cost bigint not null check (unit_cost >= 0),
  total_cost bigint not null check (total_cost >= 0),
  supplier text not null default '',
  note text not null default '',
  purchased_at timestamptz not null default now(),
  idempotency_key uuid not null unique,
  author text not null default ''
);

create table if not exists public.productions (
  id uuid primary key default gen_random_uuid(),
  bakery_id uuid not null references public.bakeries on delete cascade,
  product_id uuid not null references public.products on delete restrict,
  quantity_produced integer not null check (quantity_produced > 0),
  note text not null default '',
  produced_at timestamptz not null default now(),
  total_cost bigint not null check (total_cost >= 0),
  idempotency_key uuid not null unique,
  author text not null default ''
);

create table if not exists public.production_lines (
  id uuid primary key default gen_random_uuid(),
  bakery_id uuid not null references public.bakeries on delete cascade,
  production_id uuid not null references public.productions on delete cascade,
  ingredient_id uuid not null references public.ingredients on delete restrict,
  qty_base numeric(12,2) not null check (qty_base > 0),
  cost bigint not null check (cost >= 0)
);

create table if not exists public.stock_movements (
  id uuid primary key default gen_random_uuid(),
  bakery_id uuid not null references public.bakeries on delete cascade,
  ingredient_id uuid not null references public.ingredients on delete restrict,
  change_base numeric(12,2) not null,
  reason text not null check (reason in ('achat','production','ajustement','perte')),
  reference_id uuid,
  note text not null default '',
  created_at timestamptz not null default now(),
  author text not null default ''
);
create index if not exists idx_movements_bakery_ing on public.stock_movements (bakery_id, ingredient_id, created_at);

create table if not exists public.sales (
  id uuid primary key default gen_random_uuid(),
  bakery_id uuid not null references public.bakeries on delete cascade,
  product_id uuid not null references public.products on delete restrict,
  quantity integer not null check (quantity > 0),
  unit_price bigint not null check (unit_price >= 0),
  total bigint not null check (total >= 0),
  client text not null default '',
  note text not null default '',
  sold_at timestamptz not null default now(),
  idempotency_key uuid not null unique,
  author text not null default ''
);

-- 3) Sécurité (RLS) : chaque table filtrée par bakery_id = current_bakery() --

alter table public.bakeries        enable row level security;
alter table public.profiles        enable row level security;
alter table public.ingredients     enable row level security;
alter table public.products        enable row level security;
alter table public.recipes         enable row level security;
alter table public.purchases       enable row level security;
alter table public.productions     enable row level security;
alter table public.production_lines enable row level security;
alter table public.stock_movements enable row level security;
alter table public.sales           enable row level security;

-- La boulangerie : on ne voit que la sienne.
drop policy if exists p_bakery on public.bakeries;
create policy p_bakery on public.bakeries for select to authenticated
  using (id = public.current_bakery());

-- Le profil : chacun voit/gère son propre profil.
drop policy if exists p_profile on public.profiles;
create policy p_profile on public.profiles for all to authenticated
  using (id = auth.uid()) with check (id = auth.uid());

-- Tables métier : accès complet limité à sa propre boulangerie.
do $do$
declare t text;
begin
  foreach t in array array['ingredients','products','recipes','purchases',
                           'productions','production_lines','stock_movements','sales']
  loop
    execute format('drop policy if exists p_tenant on public.%I;', t);
    execute format(
      'create policy p_tenant on public.%I for all to authenticated
         using (bakery_id = public.current_bakery())
         with check (bakery_id = public.current_bakery());', t);
  end loop;
end $do$;

-- 4) Logique métier (scopée par locataire, exécutée avec les droits du
--    demandeur → la RLS s'applique automatiquement) --------------------------

create or replace function public.ingredient_current_qty(p_ingredient uuid)
returns numeric language sql stable as $fn$
  select coalesce(sum(change_base), 0) from public.stock_movements where ingredient_id = p_ingredient;
$fn$;

create or replace function public.record_purchase(
  p_ingredient uuid, p_qty_base numeric, p_unit_cost bigint,
  p_supplier text, p_note text, p_idempotency_key uuid, p_author text
) returns uuid language plpgsql as $fn$
declare
  v_bk uuid := public.current_bakery(); v_existing uuid; v_id uuid;
  v_factor numeric; v_before numeric; v_value_before numeric; v_bought numeric;
  v_ing public.ingredients%rowtype;
begin
  if v_bk is null then raise exception 'Non authentifié'; end if;
  select id into v_existing from public.purchases where idempotency_key = p_idempotency_key;
  if found then return v_existing; end if;
  select * into v_ing from public.ingredients where id = p_ingredient;
  if not found then raise exception 'Ingrédient introuvable'; end if;
  v_factor := case when v_ing.base_unit = 'unite' then 1 else 1000 end;
  v_before := public.ingredient_current_qty(p_ingredient) / v_factor;
  v_value_before := v_before * v_ing.unit_cost;
  v_bought := p_qty_base / v_factor;
  update public.ingredients set
    unit_cost = case when v_before + v_bought > 0
      then round((v_value_before + v_bought * p_unit_cost) / (v_before + v_bought))
      else p_unit_cost end,
    updated_at = now()
  where id = p_ingredient;
  insert into public.purchases (bakery_id, ingredient_id, qty_base, unit_cost, total_cost, supplier, note, idempotency_key, author)
  values (v_bk, p_ingredient, p_qty_base, p_unit_cost, round(v_bought * p_unit_cost), coalesce(p_supplier,''), coalesce(p_note,''), p_idempotency_key, coalesce(p_author,''))
  returning id into v_id;
  insert into public.stock_movements (bakery_id, ingredient_id, change_base, reason, reference_id, author)
  values (v_bk, p_ingredient, p_qty_base, 'achat', v_id, coalesce(p_author,''));
  return v_id;
end; $fn$;

create or replace function public.delete_purchase(p_purchase uuid)
returns void language plpgsql as $fn$
declare v_p public.purchases%rowtype;
begin
  select * into v_p from public.purchases where id = p_purchase;
  if not found then raise exception 'Achat introuvable'; end if;
  if public.ingredient_current_qty(v_p.ingredient_id) - v_p.qty_base < 0 then
    raise exception 'Stock déjà consommé en production, suppression impossible';
  end if;
  delete from public.stock_movements where reason = 'achat' and reference_id = p_purchase;
  delete from public.purchases where id = p_purchase;
end; $fn$;

create or replace function public.record_production(
  p_product uuid, p_quantity integer, p_note text, p_idempotency_key uuid, p_author text
) returns uuid language plpgsql as $fn$
declare
  v_bk uuid := public.current_bakery(); v_existing uuid; v_id uuid; v_total bigint := 0;
  v_line record; v_needed numeric; v_available numeric; v_factor numeric; v_cost bigint;
begin
  if v_bk is null then raise exception 'Non authentifié'; end if;
  select id into v_existing from public.productions where idempotency_key = p_idempotency_key;
  if found then return v_existing; end if;
  if not exists (select 1 from public.recipes where product_id = p_product) then
    raise exception 'Ce produit n''a pas de recette';
  end if;
  for v_line in
    select r.qty_base, i.* from public.recipes r join public.ingredients i on i.id = r.ingredient_id
    where r.product_id = p_product order by i.name
  loop
    v_needed := v_line.qty_base * p_quantity;
    v_available := public.ingredient_current_qty(v_line.id);
    if v_needed > v_available then
      raise exception 'Stock insuffisant : % — il manque %', v_line.name, round(v_needed - v_available, 2);
    end if;
  end loop;
  insert into public.productions (bakery_id, product_id, quantity_produced, note, total_cost, idempotency_key, author)
  values (v_bk, p_product, p_quantity, coalesce(p_note,''), 0, p_idempotency_key, coalesce(p_author,''))
  returning id into v_id;
  for v_line in
    select r.qty_base, i.* from public.recipes r join public.ingredients i on i.id = r.ingredient_id
    where r.product_id = p_product
  loop
    v_factor := case when v_line.base_unit = 'unite' then 1 else 1000 end;
    v_needed := v_line.qty_base * p_quantity;
    v_cost := round((v_needed / v_factor) * v_line.unit_cost);
    v_total := v_total + v_cost;
    insert into public.production_lines (bakery_id, production_id, ingredient_id, qty_base, cost)
    values (v_bk, v_id, v_line.id, v_needed, v_cost);
    insert into public.stock_movements (bakery_id, ingredient_id, change_base, reason, reference_id, author)
    values (v_bk, v_line.id, -v_needed, 'production', v_id, coalesce(p_author,''));
  end loop;
  update public.productions set total_cost = v_total where id = v_id;
  return v_id;
end; $fn$;

create or replace function public.record_sale(
  p_product uuid, p_quantity integer, p_unit_price bigint,
  p_client text, p_note text, p_idempotency_key uuid, p_author text
) returns uuid language plpgsql as $fn$
declare v_bk uuid := public.current_bakery(); v_existing uuid; v_id uuid; v_stock integer;
begin
  if v_bk is null then raise exception 'Non authentifié'; end if;
  select id into v_existing from public.sales where idempotency_key = p_idempotency_key;
  if found then return v_existing; end if;
  select coalesce((select sum(quantity_produced) from public.productions where product_id = p_product),0)
       - coalesce((select sum(quantity) from public.sales where product_id = p_product),0)
  into v_stock;
  if v_stock < p_quantity then raise exception 'Stock de produits finis insuffisant'; end if;
  insert into public.sales (bakery_id, product_id, quantity, unit_price, total, client, note, idempotency_key, author)
  values (v_bk, p_product, p_quantity, p_unit_price, p_unit_price * p_quantity, coalesce(p_client,''), coalesce(p_note,''), p_idempotency_key, coalesce(p_author,''))
  returning id into v_id;
  return v_id;
end; $fn$;

grant execute on function public.create_bakery(text)         to authenticated;
grant execute on function public.current_bakery()            to authenticated;
grant execute on function public.record_purchase(uuid,numeric,bigint,text,text,uuid,text) to authenticated;
grant execute on function public.delete_purchase(uuid)       to authenticated;
grant execute on function public.record_production(uuid,integer,text,uuid,text) to authenticated;
grant execute on function public.record_sale(uuid,integer,bigint,text,text,uuid,text) to authenticated;

-- ===========================================================================
-- Après exécution : dans Supabase → Authentication → activez « Email ».
-- L'inscription depuis l'app crée automatiquement la boulangerie + le profil
-- administrateur, avec une base de données vierge et isolée.
-- ===========================================================================
