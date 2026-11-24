-- RLS e permissões: o que anon, authenticated e service_role podem fazer.
-- Os dados são inseridos como dono antes de trocar de papel.
begin;
-- sessao do usuario autorizado (auth.uid()); ver test.energy_user() no _bootstrap.sql
select set_config('request.jwt.claim.sub', test.energy_user(), true);

insert into readings (device_id, metric, ts, value) values
  ('solar_plant', 'power_w', date_bin('5 minutes', now(), timestamptz '2000-01-01'), 1240),
  ('solar_plant', 'energy_total_kwh', '2026-10-08 12:00+00', 100),
  ('solar_plant', 'energy_total_kwh', '2026-10-08 13:00+00', 101);
insert into api_tokens (source, token) values ('tuya', 'segredo-de-teste');
insert into collector_runs (source, ok, readings_written, error_message)
values ('solarman', false, 0, 'mensagem interna');

-- anon nao le nada
set local role anon;
select test.throws('anon nao le readings', 'select * from readings');
select test.throws('anon nao le v_now', 'select * from v_now');
select test.throws('anon nao le v_house_daily', 'select * from v_house_daily');
select test.throws('anon nao le v_collector_status', 'select * from v_collector_status');
select test.throws('anon nao le settings', 'select * from settings');
select test.throws('anon nao grava settings', $$update settings set value = '1' where key = 'stale_after_minutes'$$);
reset role;

-- authenticated le views
set local role authenticated;
select test.ok('authenticated le v_house_daily', (select count(*) from v_house_daily) >= 0);
select test.ok('authenticated le v_credits', (select count(*) from v_credits) >= 0);
select test.ok('authenticated le v_house_hourly', (select count(*) from v_house_hourly) >= 0);
select test.ok('authenticated le v_power_hourly', (select count(*) from v_power_hourly) >= 0);
select test.ok('authenticated le v_boiler_off_sun', (select count(*) from v_boiler_off_sun) >= 0);
select test.ok('authenticated le devices', (select count(*) from devices) = 4);
select test.eq('authenticated: v_now devolve a leitura',
  (select value from v_now where device_id = 'solar_plant' and metric = 'power_w')::numeric, 1240);

-- view respeita RLS sem quebrar a leitura legítima
select test.eq('view respeita RLS: v_energy_daily',
  (select kwh from v_energy_daily
   where device_id = 'solar_plant' and metric = 'energy_total_kwh' and day = '2026-10-08')::numeric, 1);

-- authenticated nao escreve em readings
select test.throws('authenticated nao insere em readings',
  $$insert into readings (device_id, metric, ts, value) values ('solar_plant', 'power_w', '2026-10-08 12:05+00', 1)$$);
select test.throws('authenticated nao altera readings', 'update readings set value = 0');
select test.throws('authenticated nao apaga readings', 'delete from readings');

-- authenticated grava baseline e settings
insert into credit_baseline (as_of, balance_kwh) values ('2026-09-09', 2038.67);
select test.eq('authenticated grava baseline',
  (select balance_kwh from credit_baseline where as_of = '2026-09-09')::numeric, 2038.67);
update credit_baseline set balance_kwh = 2000 where as_of = '2026-09-09';
select test.eq('authenticated altera baseline',
  (select balance_kwh from credit_baseline where as_of = '2026-09-09')::numeric, 2000);
update settings set value = '20' where key = 'stale_after_minutes';
select test.ok('authenticated altera settings',
  (select value from settings where key = 'stale_after_minutes') = '20');
insert into settings (key, value) values ('tariff_per_kwh', '0.95');
select test.ok('authenticated insere settings',
  (select value from settings where key = 'tariff_per_kwh') = '0.95');

-- segredos isolados
select test.throws('authenticated nao le api_tokens', 'select * from api_tokens');
select test.throws('authenticated nao le collector_runs inteira', 'select * from collector_runs');
select test.throws('authenticated nao le error_message de collector_runs',
  'select error_message from collector_runs');
select test.eq('authenticated le source, ok e started_at de collector_runs',
  (select count(*) from (select source, ok, started_at from collector_runs) r), 1);
select test.throws('authenticated nao le device_metric_map', 'select * from device_metric_map');
select test.throws('authenticated nao le error_message pela view',
  'select error_message from v_collector_status');

-- status do coletor
select test.ok('authenticated le v_collector_status',
  (select ok = false from v_collector_status where source = 'solarman'));
reset role;

-- service_role grava leituras (coletor)
set local role service_role;
insert into readings (device_id, metric, ts, value) values ('grid_meter', 'power_w', '2026-10-08 12:05+00', 860);
select test.eq('service_role grava readings',
  (select value from readings where device_id = 'grid_meter' and metric = 'power_w')::numeric, 860);
select test.ok('service_role le api_tokens', (select count(*) from api_tokens) = 1);
reset role;

-- usuario autenticado sem cadastro em private.energy_users
select set_config('request.jwt.claim.sub', test.stranger(), true);
set local role authenticated;
select test.eq('nao cadastrado: 0 linhas em v_collector_status', (select count(*) from v_collector_status), 0);
select test.eq('nao cadastrado: 0 linhas em readings', (select count(*) from readings), 0);
select test.eq('nao cadastrado: 0 linhas em devices', (select count(*) from devices), 0);
select test.eq('nao cadastrado: get_home sem status',
  jsonb_array_length(get_home(current_date) -> 'status'), 0);
select test.throws('nao cadastrado nao grava settings',
  $$insert into settings (key, value) values ('x_intruso', '1')$$);
select test.throws('nao cadastrado nao le private.energy_users', 'select * from private.energy_users');
reset role;

-- request_collect: allowlist, 42501 e limite de 30 s (collect_trigger e um esboco local)
create function pg_temp.call_request_collect_code() returns text language plpgsql as $$
begin
  perform public.request_collect();
  return 'ok';
exception when others then
  return sqlstate;
end
$$;
grant execute on function pg_temp.call_request_collect_code() to authenticated;
create or replace function public.collect_trigger() returns void language sql as $$ select $$;
set local role authenticated;
select test.ok('nao cadastrado: request_collect da 42501', pg_temp.call_request_collect_code() = '42501');
select set_config('request.jwt.claim.sub', test.energy_user(), true);
select test.ok('autorizado: request_collect inicia', (public.request_collect() ->> 'started')::boolean);
select test.ok('autorizado: segunda chamada espera', not (public.request_collect() ->> 'started')::boolean);
reset role;
select test.ok('anon nao executa request_collect',
  not has_function_privilege('anon', 'public.request_collect()', 'execute'));

-- cadastro de usuarios
select test.eq('energy_users: so a conta de teste foi autorizada', (select count(*) from private.energy_users), 1);
select test.ok('energy_users: RLS ligado',
  (select relrowsecurity from pg_class where oid = 'private.energy_users'::regclass));
select test.ok('energy_users: policy de leitura propria',
  exists (select 1 from pg_policies where schemaname = 'private' and tablename = 'energy_users'
          and policyname = 'energy_users_self_read'));

-- funcao do event trigger do Supabase
select test.ok('anon nao executa rls_auto_enable',
  not has_function_privilege('anon', 'public.rls_auto_enable()', 'execute'));
select test.ok('authenticated nao executa rls_auto_enable',
  not has_function_privilege('authenticated', 'public.rls_auto_enable()', 'execute'));

-- RLS ligado em todas as tabelas de public
select test.eq('RLS em todas as tabelas',
  (select count(*) from pg_class c join pg_namespace n on n.oid = c.relnamespace
   where n.nspname = 'public' and c.relkind = 'r' and not c.relrowsecurity), 0);

rollback;
