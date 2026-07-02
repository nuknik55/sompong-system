-- Replaces per-dish fuel cost with a single global Q-factor (%) applied to
-- every menu's ingredient cost — standard practice: food cost = COGS only,
-- with a flat % uplift for incidentals (gas, spices, packaging) instead of
-- tracking gas usage per dish (which badly distorts cheap, quick dishes).

create table public.app_settings (
  id int primary key default 1,
  q_factor_pct numeric(5, 2) not null default 3,
  constraint app_settings_singleton check (id = 1)
);

insert into public.app_settings (id, q_factor_pct) values (1, 3);

alter table public.app_settings enable row level security;

create policy app_settings_read_all on public.app_settings
  for select using (auth.uid() is not null);
create policy app_settings_owner_write on public.app_settings
  for all using (public.is_owner()) with check (public.is_owner());
