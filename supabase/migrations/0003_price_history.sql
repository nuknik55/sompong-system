-- Logs every change to an ingredient's pricing fields automatically, with
-- who made the change and the before/after values.

create table public.ingredient_price_history (
  id uuid primary key default gen_random_uuid(),
  ingredient_id uuid not null references public.ingredients (id) on delete cascade,
  changed_by uuid references auth.users (id),
  old_purchase_cost numeric,
  new_purchase_cost numeric,
  old_receive_qty numeric,
  new_receive_qty numeric,
  old_yield_qty numeric,
  new_yield_qty numeric,
  changed_at timestamptz not null default now()
);

create or replace function public.log_ingredient_price_change()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if (old.purchase_cost is distinct from new.purchase_cost)
     or (old.receive_qty is distinct from new.receive_qty)
     or (old.yield_qty is distinct from new.yield_qty) then
    insert into public.ingredient_price_history (
      ingredient_id, changed_by, old_purchase_cost, new_purchase_cost,
      old_receive_qty, new_receive_qty, old_yield_qty, new_yield_qty
    ) values (
      new.id, auth.uid(), old.purchase_cost, new.purchase_cost,
      old.receive_qty, new.receive_qty, old.yield_qty, new.yield_qty
    );
  end if;
  return new;
end;
$$;

create trigger trg_log_ingredient_price_change
  after update on public.ingredients
  for each row execute function public.log_ingredient_price_change();

alter table public.ingredient_price_history enable row level security;

create policy ingredient_price_history_read_all on public.ingredient_price_history
  for select using (auth.uid() is not null);
