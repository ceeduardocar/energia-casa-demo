-- energy_hourly (mantida por gatilho) e v_now (busca por índice) dão os mesmos
-- resultados das definições originais, em insert, backfill, delete e truncate.
begin;
-- sessao do usuario autorizado (auth.uid()); ver test.energy_user() no _bootstrap.sql
select set_config('request.jwt.claim.sub', test.energy_user(), true);

create function pg_temp.diff_count() returns bigint language sql as $$
  select (select count(*) from (
    select device_id, metric, date_trunc('hour', ts at time zone 'America/Sao_Paulo') h, sum(delta_kwh) k
    from v_energy_deltas group by 1, 2, 3
    except select device_id, metric, hour_local, kwh from energy_hourly) a)
  + (select count(*) from (
    select device_id, metric, hour_local, kwh from energy_hourly
    except select device_id, metric, date_trunc('hour', ts at time zone 'America/Sao_Paulo'), sum(delta_kwh)
    from v_energy_deltas group by 1, 2, 3) b);
$$;

-- inserts em lotes, como o coletor
insert into readings (device_id, metric, ts, value) values
  ('solar_plant', 'energy_total_kwh', '2026-10-08 12:00+00', 100),
  ('grid_meter', 'energy_export_total_kwh', '2026-10-08 12:00+00', 50);
insert into readings (device_id, metric, ts, value) values
  ('solar_plant', 'energy_total_kwh', '2026-10-08 12:05+00', 100.2),
  ('solar_plant', 'energy_total_kwh', '2026-10-08 13:10+00', 101),
  ('grid_meter', 'energy_export_total_kwh', '2026-10-08 13:10+00', 50.5);
select test.eq('insert: igual a v_energy_deltas', pg_temp.diff_count(), 0);
select test.eq('insert: hora 09:00 (12:05Z)',
  (select kwh from energy_hourly where device_id = 'solar_plant' and hour_local = '2026-10-08 09:00')::numeric, 0.2);

-- leitura nova no fim da série
insert into readings (device_id, metric, ts, value) values ('solar_plant', 'energy_total_kwh', '2026-10-08 13:15+00', 101.4);
select test.eq('fim da serie: igual', pg_temp.diff_count(), 0);
select test.eq('fim da serie: hora 10:00 soma as duas leituras',
  (select kwh from energy_hourly where device_id = 'solar_plant' and hour_local = '2026-10-08 10:00')::numeric, 1.2);

-- backfill: leitura antiga no meio da série muda o delta da leitura seguinte
insert into readings (device_id, metric, ts, value) values ('solar_plant', 'energy_total_kwh', '2026-10-08 12:30+00', 100.5);
select test.eq('backfill no meio: igual', pg_temp.diff_count(), 0);

-- backfill antes da primeira leitura: a antiga passa a ser a primeira (delta 0)
insert into readings (device_id, metric, ts, value) values ('solar_plant', 'energy_total_kwh', '2026-10-07 12:00+00', 90);
select test.eq('backfill antes da primeira: igual', pg_temp.diff_count(), 0);

-- contador que zera continua dando delta zero, nunca negativo
insert into readings (device_id, metric, ts, value) values ('appliance_ac', 'energy_total_kwh', '2026-10-08 12:00+00', 100),
  ('appliance_ac', 'energy_total_kwh', '2026-10-08 13:00+00', 3);
select test.eq('contador zerado: igual', pg_temp.diff_count(), 0);
select test.eq('contador zerado: nenhum kwh negativo', (select count(*) from energy_hourly where kwh < 0), 0);

-- métricas que não são de energia não entram
insert into readings (device_id, metric, ts, value) values ('solar_plant', 'power_w', '2026-10-08 12:00+00', 1500);
select test.eq('potencia nao entra', (select count(*) from energy_hourly where metric = 'power_w'), 0);

-- delete recalcula
delete from readings where device_id = 'solar_plant' and metric = 'energy_total_kwh' and ts = '2026-10-08 12:30+00';
select test.eq('delete: igual', pg_temp.diff_count(), 0);
delete from readings where device_id = 'solar_plant' and metric = 'energy_total_kwh';
select test.eq('delete da serie: some da tabela',
  (select count(*) from energy_hourly where device_id = 'solar_plant'), 0);

-- rebuild_energy_hourly refaz do zero e dá o mesmo resultado
delete from energy_hourly;
select rebuild_energy_hourly();
select test.eq('rebuild: igual', pg_temp.diff_count(), 0);

-- v_now: última leitura de cada série, igual ao distinct on original
select test.eq('v_now: mesmas series e valores',
  (with ref as (select distinct on (device_id, metric) device_id, metric, ts, value
                from readings order by device_id, metric, ts desc)
   select (select count(*) from (select device_id, metric, ts, value from v_now except select * from ref) a)
        + (select count(*) from (select * from ref except select device_id, metric, ts, value from v_now) b)), 0);
select test.eq('v_now: uma linha por serie',
  (select count(*) from v_now), (select count(*) from (select distinct device_id, metric from readings) s));
select test.is_null('v_now: sem leituras fica vazio',
  (select ts from v_now where device_id = 'nao_existe'));

-- truncate zera a tabela derivada
truncate readings;
select test.eq('truncate: tabela derivada vazia', (select count(*) from energy_hourly), 0);

-- permissões: anon não lê a tabela; authenticated lê pelas views
insert into readings (device_id, metric, ts, value) values ('solar_plant', 'energy_total_kwh', '2026-10-08 12:00+00', 100),
  ('solar_plant', 'energy_total_kwh', '2026-10-08 13:00+00', 101);
set local role anon;
select test.throws('anon nao le energy_hourly', 'select * from energy_hourly');
select test.throws('anon nao le v_now', 'select * from v_now');
reset role;
set local role authenticated;
select test.eq('authenticated le v_energy_daily', (select kwh from v_energy_daily where day = '2026-10-08')::numeric, 1);
select test.ok('authenticated le v_now', (select count(*) from v_now) = 1);
select test.throws('authenticated nao escreve energy_hourly', 'delete from energy_hourly');
reset role;

rollback;
