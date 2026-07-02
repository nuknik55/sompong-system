-- Lets the owner permanently map a POS product name (e.g. a weight-counted
-- variant like "กุ้งก้ามกรามเผา 5 ขีด") to an existing menu + a divisor, so
-- every future sales import converts it automatically without re-doing the
-- merge by hand each time.

create table public.pos_sales_aliases (
  id uuid primary key default gen_random_uuid(),
  pos_product_name text not null unique,
  menu_id uuid not null references public.menus (id) on delete cascade,
  divisor numeric(10, 4) not null default 1,
  created_at timestamptz not null default now()
);

alter table public.pos_sales_aliases enable row level security;

create policy pos_sales_aliases_read_all on public.pos_sales_aliases
  for select using (auth.uid() is not null);
create policy pos_sales_aliases_owner_write on public.pos_sales_aliases
  for all using (public.is_owner()) with check (public.is_owner());
