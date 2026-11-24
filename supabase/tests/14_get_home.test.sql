-- get_home devolve o Início inteiro em um jsonb, com o RLS de quem chama.
begin;
-- sessao do usuario autorizado (auth.uid()); ver test.energy_user() no _bootstrap.sql
select set_config('request.jwt.claim.sub', test.energy_user(), true);

insert into readings (device_id, metric, ts, value) values
  ('solar_plant', 'energy_total_kwh', '2026-10-08 12:00+00', 100),
  ('solar_plant', 'energy_total_kwh', '2026-10-08 13:00+00', 101.5),
  ('grid_meter', 'energy_import_total_kwh', '2026-10-08 12:00+00', 10),
  ('grid_meter', 'energy_import_total_kwh', '2026-10-08 13:00+00', 10.4),
  ('grid_meter', 'energy_export_total_kwh', '2026-10-08 12:00+00', 20),
  ('grid_meter', 'energy_export_total_kwh', '2026-10-08 13:00+00', 20.5),
  ('solar_plant', 'power_w', '2026-10-08 13:00+00', 1200);
insert into events (kind, started_at) values
  ('carro', '2026-10-08 23:00+00'), ('piscina', '2026-10-08 12:00+00');
insert into events (kind, started_at) values ('carro', '2026-10-09 04:00+00'); -- 01:00 local do dia 9

set local role authenticated;
select test.eq('get_home: linhas por hora', jsonb_array_length(get_home('2026-10-08') -> 'hourly'), 2);
select test.eq('get_home: consumo da hora 10:00',
  ((get_home('2026-10-08') -> 'hourly' -> 1 ->> 'consumo'))::numeric, 1.4);
select test.ok('get_home: horas em ordem',
  (get_home('2026-10-08') -> 'hourly' -> 0 ->> 'hour_local') < (get_home('2026-10-08') -> 'hourly' -> 1 ->> 'hour_local'));
select test.ok('get_home: hour_local no formato ISO',
  (get_home('2026-10-08') -> 'hourly' -> 0 ->> 'hour_local') ~ '^2026-10-08T09:00:00');
select test.eq('get_home: v_now com as series', jsonb_array_length(get_home('2026-10-08') -> 'now'), 4);
select test.ok('get_home: carro do dia', (get_home('2026-10-08') ->> 'car')::boolean);
select test.ok('get_home: carro das 01:00 do dia 9 nao conta no dia 8',
  not (get_home('2026-10-10') ->> 'car')::boolean);
select test.ok('get_home: bomba aberta', (get_home('2026-10-08') -> 'pool' ->> 'kind') = 'piscina');
select test.eq('get_home: dia sem dados vem vazio', jsonb_array_length(get_home('2026-01-01') -> 'hourly'), 0);
select test.ok('get_home: chaves', (select array_agg(k order by k) from jsonb_object_keys(get_home('2026-10-08')) k)
  = array['car','hourly','now','pool','self','status']);
reset role;

set local role anon;
select test.throws('anon nao executa get_home', $$select get_home('2026-10-08')$$);
reset role;

rollback;
