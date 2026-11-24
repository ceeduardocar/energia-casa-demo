-- Casa por dia e por hora: consumo, autoconsumo, autossuficiência e "outros".
-- Cada caso grava uma leitura âncora às 00:00 locais (delta 0) e outra mais
-- tarde no mesmo dia, para que o delta do dia seja exato.
begin;

create temp table day_case (device_id text, metric text, kwh double precision);

create function pg_temp.load_day(day_utc_start timestamptz) returns void language sql as $$
  insert into readings (device_id, metric, ts, value)
  select device_id, metric, day_utc_start, 1000 from day_case
  union all
  select device_id, metric, day_utc_start + interval '14 hours', 1000 + kwh from day_case;
$$;

-- exemplo da spec: g = 9,8, i = 4,5, e = 3,1, ar = 3,1, boiler = 2,8
insert into day_case values
  ('solar_plant', 'energy_total_kwh', 9.8),
  ('grid_meter', 'energy_import_total_kwh', 4.5),
  ('grid_meter', 'energy_export_total_kwh', 3.1),
  ('appliance_ac', 'energy_total_kwh', 3.1),
  ('appliance_boiler', 'energy_total_kwh', 2.8);
select pg_temp.load_day('2026-10-08 03:00+00');
select test.eq('exemplo da spec: consumo',
  (select consumo from v_house_daily where day = '2026-10-08')::numeric, 11.2);
select test.eq('exemplo da spec: autoconsumo',
  (select autoconsumo from v_house_daily where day = '2026-10-08')::numeric, 6.7);
select test.eq('exemplo da spec: autossuficiencia',
  (select autossuficiencia from v_house_daily where day = '2026-10-08')::numeric, 0.5982);
-- outros com ar e boiler
select test.eq('outros com ar e boiler',
  (select outros from v_house_daily where day = '2026-10-08')::numeric, 5.3);
delete from readings; delete from day_case;

-- outros nunca negativo: ar + boiler maiores que o consumo
insert into day_case values
  ('solar_plant', 'energy_total_kwh', 2),
  ('grid_meter', 'energy_import_total_kwh', 1),
  ('grid_meter', 'energy_export_total_kwh', 0),
  ('appliance_ac', 'energy_total_kwh', 2.5),
  ('appliance_boiler', 'energy_total_kwh', 1.5);
select pg_temp.load_day('2026-10-08 03:00+00');
select test.eq('outros nunca negativo',
  (select outros from v_house_daily where day = '2026-10-08')::numeric, 0);
delete from readings; delete from day_case;

-- fonte sem dados vira nulo: dia sem grid_meter
insert into day_case values ('solar_plant', 'energy_total_kwh', 5);
select pg_temp.load_day('2026-10-08 03:00+00');
select test.eq('fonte sem dados: g preenchido',
  (select g from v_house_daily where day = '2026-10-08')::numeric, 5);
select test.is_null('fonte sem dados: i', (select i from v_house_daily where day = '2026-10-08'));
select test.is_null('fonte sem dados: e', (select e from v_house_daily where day = '2026-10-08'));
select test.is_null('fonte sem dados: consumo', (select consumo from v_house_daily where day = '2026-10-08'));
select test.is_null('fonte sem dados: autoconsumo', (select autoconsumo from v_house_daily where day = '2026-10-08'));
select test.is_null('fonte sem dados: autossuficiencia', (select autossuficiencia from v_house_daily where day = '2026-10-08'));
select test.is_null('fonte sem dados: outros', (select outros from v_house_daily where day = '2026-10-08'));
delete from readings; delete from day_case;

-- aparelho ausente: sem boiler
insert into day_case values
  ('solar_plant', 'energy_total_kwh', 9.8),
  ('grid_meter', 'energy_import_total_kwh', 4.5),
  ('grid_meter', 'energy_export_total_kwh', 3.1),
  ('appliance_ac', 'energy_total_kwh', 3.1);
select pg_temp.load_day('2026-10-08 03:00+00');
select test.is_null('aparelho ausente: bo', (select bo from v_house_daily where day = '2026-10-08'));
select test.eq('aparelho ausente: outros',
  (select outros from v_house_daily where day = '2026-10-08')::numeric, 8.1);
delete from readings; delete from day_case;

-- consumo zero
insert into day_case values
  ('solar_plant', 'energy_total_kwh', 0),
  ('grid_meter', 'energy_import_total_kwh', 0),
  ('grid_meter', 'energy_export_total_kwh', 0);
select pg_temp.load_day('2026-10-08 03:00+00');
select test.eq('consumo zero: consumo',
  (select consumo from v_house_daily where day = '2026-10-08')::numeric, 0);
select test.eq('consumo zero: autossuficiencia',
  (select autossuficiencia from v_house_daily where day = '2026-10-08')::numeric, 0);
delete from readings; delete from day_case;

-- autoconsumo limitado: exportado maior que a geração (dado ruim)
insert into day_case values
  ('solar_plant', 'energy_total_kwh', 1),
  ('grid_meter', 'energy_import_total_kwh', 5),
  ('grid_meter', 'energy_export_total_kwh', 2);
select pg_temp.load_day('2026-10-08 03:00+00');
select test.eq('autoconsumo limitado',
  (select autoconsumo from v_house_daily where day = '2026-10-08')::numeric, 0);
select test.ok('autossuficiencia entre 0 e 1',
  (select autossuficiencia between 0 and 1 from v_house_daily where day = '2026-10-08'));
delete from readings; delete from day_case;

-- Atualizacoes assincronas podem fazer a exportacao aparecer antes da geracao.
insert into day_case values
  ('solar_plant', 'energy_total_kwh', 1),
  ('grid_meter', 'energy_import_total_kwh', 0),
  ('grid_meter', 'energy_export_total_kwh', 2);
select pg_temp.load_day('2026-10-08 03:00+00');
select test.eq('consumo diario nunca negativo',
  (select consumo from v_house_daily where day = '2026-10-08')::numeric, 0);
select test.eq('consumo horario nunca negativo',
  (select consumo from v_house_hourly where hour_local = '2026-10-08 14:00')::numeric, 0);
select test.eq('autossuficiencia nunca negativa',
  (select autossuficiencia from v_house_daily where day = '2026-10-08')::numeric, 0);
delete from readings; delete from day_case;

-- por hora: âncora às 09:00 locais, fim às 10:30 locais (hora 10:00)
insert into readings (device_id, metric, ts, value) values
  ('solar_plant', 'energy_total_kwh', '2026-10-08 12:00+00', 100),
  ('grid_meter', 'energy_import_total_kwh', '2026-10-08 12:00+00', 100),
  ('grid_meter', 'energy_export_total_kwh', '2026-10-08 12:00+00', 100),
  ('solar_plant', 'energy_total_kwh', '2026-10-08 13:30+00', 101.0),
  ('grid_meter', 'energy_import_total_kwh', '2026-10-08 13:30+00', 100.5),
  ('grid_meter', 'energy_export_total_kwh', '2026-10-08 13:30+00', 100.2);
select test.eq('por hora: consumo',
  (select consumo from v_house_hourly where hour_local = '2026-10-08 10:00')::numeric, 1.3);
select test.eq('por hora: outros sem aparelhos',
  (select outros from v_house_hourly where hour_local = '2026-10-08 10:00')::numeric, 1.3);
delete from readings;

-- contador sem mudança na hora mantém delta zero em vez de apagar o consumo.
insert into readings (device_id, metric, ts, value) values
  ('solar_plant', 'energy_total_kwh', '2026-10-08 20:00+00', 110),
  ('grid_meter', 'energy_import_total_kwh', '2026-10-08 20:00+00', 200),
  ('grid_meter', 'energy_export_total_kwh', '2026-10-08 20:00+00', 300),
  ('grid_meter', 'energy_import_total_kwh', '2026-10-08 21:30+00', 200.4);
select test.eq('por hora: geracao parada vira zero',
  (select g from v_house_hourly where hour_local = '2026-10-08 18:00')::numeric, 0);
select test.eq('por hora: exportacao parada vira zero',
  (select e from v_house_hourly where hour_local = '2026-10-08 18:00')::numeric, 0);
select test.eq('por hora: consumo continua depois que exportacao para',
  (select consumo from v_house_hourly where hour_local = '2026-10-08 18:00')::numeric, 0.4);
delete from readings;

-- A mesma regra vale em um dia posterior sem nova geração ou exportação.
insert into readings (device_id, metric, ts, value) values
  ('solar_plant', 'energy_total_kwh', '2026-10-08 12:00+00', 110),
  ('grid_meter', 'energy_import_total_kwh', '2026-10-08 12:00+00', 200),
  ('grid_meter', 'energy_export_total_kwh', '2026-10-08 12:00+00', 300),
  ('grid_meter', 'energy_import_total_kwh', '2026-10-09 12:00+00', 201.2);
select test.eq('por dia: exportacao parada vira zero',
  (select e from v_house_daily where day = '2026-10-09')::numeric, 0);
select test.eq('por dia: consumo continua sem nova exportacao',
  (select consumo from v_house_daily where day = '2026-10-09')::numeric, 1.2);
delete from readings;

rollback;
