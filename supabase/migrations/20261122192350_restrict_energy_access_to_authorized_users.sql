-- Restringe todos os dados residenciais aos usuarios autorizados do Energia Casa.
create schema if not exists private;

create table if not exists private.energy_users (
  user_id uuid primary key references auth.users(id) on delete cascade,
  created_at timestamptz not null default now()
);

revoke all on schema private from public, anon;
grant usage on schema private to authenticated;
revoke all on table private.energy_users from public, anon, authenticated;

-- Em uma instalacao pessoal nova, autoriza automaticamente somente quando existe uma unica conta.
do $$
begin
  if not exists (select 1 from private.energy_users)
     and (select count(*) from auth.users) = 1 then
    insert into private.energy_users (user_id)
    select id from auth.users;
  end if;
end
$$;

create or replace function private.is_energy_user()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from private.energy_users eu
    where eu.user_id = (select auth.uid())
  );
$$;

revoke all on function private.is_energy_user() from public, anon;
grant execute on function private.is_energy_user() to authenticated;

-- Remove as politicas permissivas antigas.
drop policy if exists authenticated_read on public.readings;
drop policy if exists authenticated_read on public.devices;
drop policy if exists authenticated_read on public.energy_hourly;
drop policy if exists authenticated_read on public.credit_baseline;
drop policy if exists authenticated_insert on public.credit_baseline;
drop policy if exists authenticated_update on public.credit_baseline;
drop policy if exists authenticated_read on public.settings;
drop policy if exists authenticated_insert on public.settings;
drop policy if exists authenticated_update on public.settings;
drop policy if exists authenticated_read on public.bills;
drop policy if exists authenticated_insert on public.bills;
drop policy if exists events_select on public.events;
drop policy if exists events_insert on public.events;
drop policy if exists events_update on public.events;
drop policy if exists events_delete on public.events;
drop policy if exists authenticated_read on public.grid_meter_audits;
drop policy if exists authenticated_insert on public.grid_meter_audits;
drop policy if exists authenticated_delete on public.grid_meter_audits;
drop policy if exists authenticated_status_read on public.collector_runs;

-- Leituras.
create policy authenticated_read on public.readings
for select to authenticated using ((select private.is_energy_user()));

create policy authenticated_read on public.devices
for select to authenticated using ((select private.is_energy_user()));

create policy authenticated_read on public.energy_hourly
for select to authenticated using ((select private.is_energy_user()));

create policy authenticated_status_read on public.collector_runs
for select to authenticated using ((select private.is_energy_user()));

-- Configuracoes e creditos.
create policy authenticated_read on public.credit_baseline
for select to authenticated using ((select private.is_energy_user()));
create policy authenticated_insert on public.credit_baseline
for insert to authenticated with check ((select private.is_energy_user()));
create policy authenticated_update on public.credit_baseline
for update to authenticated
using ((select private.is_energy_user()))
with check ((select private.is_energy_user()));

create policy authenticated_read on public.settings
for select to authenticated using ((select private.is_energy_user()));
create policy authenticated_insert on public.settings
for insert to authenticated with check ((select private.is_energy_user()));
create policy authenticated_update on public.settings
for update to authenticated
using ((select private.is_energy_user()))
with check ((select private.is_energy_user()));

-- Contas e eventos.
create policy authenticated_read on public.bills
for select to authenticated using ((select private.is_energy_user()));
create policy authenticated_insert on public.bills
for insert to authenticated with check ((select private.is_energy_user()));

create policy events_select on public.events
for select to authenticated using ((select private.is_energy_user()));
create policy events_insert on public.events
for insert to authenticated with check ((select private.is_energy_user()));
create policy events_update on public.events
for update to authenticated
using ((select private.is_energy_user()))
with check ((select private.is_energy_user()));
create policy events_delete on public.events
for delete to authenticated using ((select private.is_energy_user()));

create policy authenticated_read on public.grid_meter_audits
for select to authenticated using ((select private.is_energy_user()));
create policy authenticated_insert on public.grid_meter_audits
for insert to authenticated with check ((select private.is_energy_user()));
create policy authenticated_delete on public.grid_meter_audits
for delete to authenticated using ((select private.is_energy_user()));

-- Evita que um usuario autenticado contorne RLS com TRUNCATE.
revoke truncate on all tables in schema public from authenticated;

-- Views devem respeitar o RLS das tabelas de origem.
do $$
declare
  view_name text;
begin
  for view_name in
    select c.relname
    from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public' and c.relkind = 'v'
  loop
    execute format('alter view public.%I set (security_invoker = true)', view_name);
  end loop;
end
$$;

-- A atualizacao manual do coletor tambem exige autorizacao explicita.
create or replace function public.request_collect()
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  last_at timestamptz;
  gap constant interval := interval '30 seconds';
begin
  if not (select private.is_energy_user()) then
    raise exception 'nao autorizado' using errcode = '42501';
  end if;

  select value::timestamptz
  into last_at
  from public.settings
  where key = 'refresh_requested_at';

  if last_at is not null and now() - last_at < gap then
    return jsonb_build_object(
      'started', false,
      'wait_s', ceil(extract(epoch from gap - (now() - last_at)))::int
    );
  end if;

  insert into public.settings (key, value)
  values ('refresh_requested_at', now()::text)
  on conflict (key) do update set value = excluded.value;

  perform public.collect_trigger();
  return jsonb_build_object('started', true);
end;
$$;

revoke all on function public.request_collect() from public, anon;
grant execute on function public.request_collect() to authenticated;