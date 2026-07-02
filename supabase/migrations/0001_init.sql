-- ============================================================================
-- Restaurant Food Cost Control + Menu Engineering — initial schema (Phase 1)
-- ============================================================================

create extension if not exists pgcrypto;

-- ----------------------------------------------------------------------------
-- profiles: 1 row per auth.users, carries the role (owner / staff)
-- ----------------------------------------------------------------------------
create table public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  full_name text not null,
  role text not null check (role in ('owner', 'staff')),
  created_at timestamptz not null default now()
);

create or replace function public.current_role()
returns text
language sql
stable
security definer
set search_path = public
as $$
  select role from public.profiles where id = auth.uid();
$$;

create or replace function public.is_owner()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select public.current_role() = 'owner';
$$;

-- ----------------------------------------------------------------------------
-- ingredients: raw purchased materials AND "prepared" items (sub-recipes)
-- promoted into the same list, mirroring the original spreadsheet's design
-- so a single dropdown can offer both to staff when building a recipe.
-- ----------------------------------------------------------------------------
create table public.ingredients (
  id uuid primary key default gen_random_uuid(),
  name text not null unique,
  category text,
  is_prep boolean not null default false,

  -- Raw-ingredient pricing (ignored when is_prep = true)
  purchase_unit_label text,      -- original free-text unit, e.g. "ลัง(20ถุง)"
  purchase_cost numeric(12, 2),  -- cost per purchase_unit_label
  receive_qty numeric(12, 4) not null default 1,   -- E: qty received per purchase
  yield_qty numeric(12, 4),                        -- F: usable qty produced
  usage_unit text,               -- small unit used in recipes, e.g. "กรัม"

  -- Link to the prep recipe that defines this item's cost (when is_prep = true)
  -- (FK added below via ALTER TABLE, since prep_recipes is created after this table)
  prep_recipe_id uuid unique,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- ----------------------------------------------------------------------------
-- prep_recipes: header for a "prepared item" (e.g. น้ำจิ้มซีฟู้ด)
-- ----------------------------------------------------------------------------
create table public.prep_recipes (
  id uuid primary key default gen_random_uuid(),
  name text not null unique,
  category text,
  batch_yield_qty numeric(12, 4) not null,   -- total output of one batch
  batch_yield_unit text not null,            -- unit of that output, e.g. "กรัม"
  note text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.ingredients
  add constraint ingredients_prep_recipe_fk
  foreign key (prep_recipe_id) references public.prep_recipes (id) on delete set null;

create table public.prep_recipe_items (
  id uuid primary key default gen_random_uuid(),
  prep_recipe_id uuid not null references public.prep_recipes (id) on delete cascade,
  ingredient_id uuid not null references public.ingredients (id) on delete restrict,
  quantity numeric(12, 4) not null,
  unit text,
  note text,
  sort_order int not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- ----------------------------------------------------------------------------
-- menus: header for a sellable dish
-- ----------------------------------------------------------------------------
create table public.menus (
  id uuid primary key default gen_random_uuid(),
  name text not null unique,
  category text,
  selling_price numeric(12, 2) not null,
  fuel_cost numeric(12, 2) not null default 0,  -- ค่าแก๊ส/เชื้อเพลิงต่อจาน (บาท)
  last_period_qty_sold numeric(12, 2) not null default 0, -- snapshot from latest POS import (Phase 1 manual)
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.menu_recipe_items (
  id uuid primary key default gen_random_uuid(),
  menu_id uuid not null references public.menus (id) on delete cascade,
  ingredient_id uuid not null references public.ingredients (id) on delete restrict,
  quantity numeric(12, 4) not null,
  unit text,
  note text,
  sort_order int not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- ----------------------------------------------------------------------------
-- updated_at triggers
-- ----------------------------------------------------------------------------
create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create trigger trg_ingredients_updated_at before update on public.ingredients
  for each row execute function public.set_updated_at();
create trigger trg_prep_recipes_updated_at before update on public.prep_recipes
  for each row execute function public.set_updated_at();
create trigger trg_prep_recipe_items_updated_at before update on public.prep_recipe_items
  for each row execute function public.set_updated_at();
create trigger trg_menus_updated_at before update on public.menus
  for each row execute function public.set_updated_at();
create trigger trg_menu_recipe_items_updated_at before update on public.menu_recipe_items
  for each row execute function public.set_updated_at();

-- ----------------------------------------------------------------------------
-- Row Level Security
--   owner  : full read/write on everything
--   staff  : read everything, but can only write recipe LINE ITEMS
--            (menu_recipe_items / prep_recipe_items) — never prices/headers.
-- ----------------------------------------------------------------------------
alter table public.profiles enable row level security;
alter table public.ingredients enable row level security;
alter table public.prep_recipes enable row level security;
alter table public.prep_recipe_items enable row level security;
alter table public.menus enable row level security;
alter table public.menu_recipe_items enable row level security;

create policy profiles_select_own on public.profiles
  for select using (id = auth.uid() or public.is_owner());
create policy profiles_owner_write on public.profiles
  for all using (public.is_owner()) with check (public.is_owner());

create policy ingredients_read_all on public.ingredients
  for select using (auth.uid() is not null);
create policy ingredients_owner_write on public.ingredients
  for all using (public.is_owner()) with check (public.is_owner());

create policy prep_recipes_read_all on public.prep_recipes
  for select using (auth.uid() is not null);
create policy prep_recipes_owner_write on public.prep_recipes
  for all using (public.is_owner()) with check (public.is_owner());

create policy prep_recipe_items_read_all on public.prep_recipe_items
  for select using (auth.uid() is not null);
create policy prep_recipe_items_staff_write on public.prep_recipe_items
  for all using (auth.uid() is not null) with check (auth.uid() is not null);

create policy menus_read_all on public.menus
  for select using (auth.uid() is not null);
create policy menus_owner_write on public.menus
  for all using (public.is_owner()) with check (public.is_owner());

create policy menu_recipe_items_read_all on public.menu_recipe_items
  for select using (auth.uid() is not null);
create policy menu_recipe_items_staff_write on public.menu_recipe_items
  for all using (auth.uid() is not null) with check (auth.uid() is not null);

-- Auto-create a profile row (default role = staff) whenever a new auth user signs up.
-- The first user is promoted to 'owner' manually after signup (see deployment guide).
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (id, full_name, role)
  values (new.id, coalesce(new.raw_user_meta_data->>'full_name', new.email), 'staff');
  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();
