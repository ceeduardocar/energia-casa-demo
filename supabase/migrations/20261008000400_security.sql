-- Segurança (spec, seção 6): RLS em todas as tabelas, nada para anon, leitura
-- das views e gravação só de credit_baseline e settings para authenticated.
-- service_role (coletor) ignora RLS e mantém os privilégios padrão do Supabase.

alter table public.devices           enable row level security;
alter table public.readings          enable row level security;
alter table public.device_metric_map enable row level security;
alter table public.api_tokens        enable row level security;
alter table public.collector_runs    enable row level security;
alter table public.credit_baseline   enable row level security;
alter table public.settings          enable row level security;

-- O Supabase concede tudo a anon e authenticated por padrão: começar do zero.
revoke all on all tables in schema public from anon, authenticated;
revoke all on all sequences in schema public from anon, authenticated;

-- Views de cálculo rodam com as permissões de quem consulta.
alter view public.v_energy_deltas  set (security_invoker = true);
alter view public.v_energy_hourly  set (security_invoker = true);
alter view public.v_energy_daily   set (security_invoker = true);
alter view public.v_power_hourly   set (security_invoker = true);
alter view public.v_now            set (security_invoker = true);
alter view public.v_house_hourly   set (security_invoker = true);
alter view public.v_house_daily    set (security_invoker = true);
alter view public.v_credits        set (security_invoker = true);
alter view public.v_boiler_off_sun set (security_invoker = true);

-- Leitura (tabelas que as views usam e as telas mostram).
grant select on public.devices, public.readings, public.settings, public.credit_baseline
  to authenticated;
create policy authenticated_read on public.devices
  for select to authenticated using (true);
create policy authenticated_read on public.readings
  for select to authenticated using (true);
create policy authenticated_read on public.settings
  for select to authenticated using (true);
create policy authenticated_read on public.credit_baseline
  for select to authenticated using (true);

-- Gravação: só baseline de créditos e ajustes.
grant insert, update on public.credit_baseline, public.settings to authenticated;
create policy authenticated_insert on public.credit_baseline
  for insert to authenticated with check (true);
create policy authenticated_update on public.credit_baseline
  for update to authenticated using (true) with check (true);
create policy authenticated_insert on public.settings
  for insert to authenticated with check (true);
create policy authenticated_update on public.settings
  for update to authenticated using (true) with check (true);

-- Views.
grant select on
  public.v_energy_deltas, public.v_energy_hourly, public.v_energy_daily,
  public.v_power_hourly, public.v_now, public.v_house_hourly, public.v_house_daily,
  public.v_credits, public.v_boiler_off_sun, public.v_collector_status
  to authenticated;

-- api_tokens, collector_runs e device_metric_map: nenhum privilégio e nenhuma
-- política para anon e authenticated. O status do coletor chega ao app só por
-- v_collector_status (view com os direitos do dono, sem error_message).
