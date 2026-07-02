-- Logs every add/edit/remove of a recipe line item (on both menus and preps)
-- so changes to a dish's composition — not just ingredient prices — are
-- traceable to who made them and when.

create table public.recipe_item_history (
  id uuid primary key default gen_random_uuid(),
  target_type text not null check (target_type in ('menu', 'prep')),
  parent_id uuid not null,
  ingredient_id uuid,
  action text not null check (action in ('insert', 'update', 'delete')),
  old_quantity numeric,
  new_quantity numeric,
  changed_by uuid references auth.users (id),
  changed_at timestamptz not null default now()
);

create index on public.recipe_item_history (target_type, parent_id);

create or replace function public.log_recipe_item_change()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_target_type text;
  v_parent_id uuid;
begin
  v_target_type := case when tg_table_name = 'menu_recipe_items' then 'menu' else 'prep' end;

  if tg_op = 'INSERT' then
    v_parent_id := case when v_target_type = 'menu' then new.menu_id else new.prep_recipe_id end;
    insert into public.recipe_item_history (target_type, parent_id, ingredient_id, action, new_quantity, changed_by)
    values (v_target_type, v_parent_id, new.ingredient_id, 'insert', new.quantity, auth.uid());
  elsif tg_op = 'UPDATE' then
    v_parent_id := case when v_target_type = 'menu' then new.menu_id else new.prep_recipe_id end;
    if old.quantity is distinct from new.quantity or old.ingredient_id is distinct from new.ingredient_id then
      insert into public.recipe_item_history (target_type, parent_id, ingredient_id, action, old_quantity, new_quantity, changed_by)
      values (v_target_type, v_parent_id, new.ingredient_id, 'update', old.quantity, new.quantity, auth.uid());
    end if;
  elsif tg_op = 'DELETE' then
    v_parent_id := case when v_target_type = 'menu' then old.menu_id else old.prep_recipe_id end;
    insert into public.recipe_item_history (target_type, parent_id, ingredient_id, action, old_quantity, changed_by)
    values (v_target_type, v_parent_id, old.ingredient_id, 'delete', old.quantity, auth.uid());
  end if;
  return coalesce(new, old);
end;
$$;

create trigger trg_log_menu_recipe_item_change
  after insert or update or delete on public.menu_recipe_items
  for each row execute function public.log_recipe_item_change();

create trigger trg_log_prep_recipe_item_change
  after insert or update or delete on public.prep_recipe_items
  for each row execute function public.log_recipe_item_change();

alter table public.recipe_item_history enable row level security;

create policy recipe_item_history_read_all on public.recipe_item_history
  for select using (auth.uid() is not null);
