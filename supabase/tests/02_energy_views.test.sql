-- Energia por hora e por dia a partir das diferenças do acumulado, e v_now.
begin;

-- dia normal: 00:00, 09:00 e 23:55 locais do dia 8
insert into readings (device_id, metric, ts, value) values
  ('solar_plant', 'energy_total_kwh', '2026-10-08 03:00+00', 100),
  ('solar_plant', 'energy_total_kwh', '2026-10-08 12:00+00', 105),
  ('solar_plant', 'energy_total_kwh', '2026-10-09 02:55+00', 109);
select test.eq('dia normal: total do dia',
  (select kwh from v_energy_daily
   where device_id = 'solar_plant' and metric = 'energy_total_kwh' and day = '2026-10-08')::numeric, 9);
-- a diferença vai para a hora da leitura mais recente: 100 -> 105 às 09:00, 105 -> 109 às 23:55
select test.eq('dia normal: hora 09:00',
  (select kwh from v_energy_hourly
   where device_id = 'solar_plant' and metric = 'energy_total_kwh' and hour_local = '2026-10-08 09:00')::numeric, 5);
select test.eq('dia normal: hora 23:00',
  (select kwh from v_energy_hourly
   where device_id = 'solar_plant' and metric = 'energy_total_kwh' and hour_local = '2026-10-08 23:00')::numeric, 4);
delete from readings;

-- primeira leitura tem delta zero
insert into readings (device_id, metric, ts, value) values
  ('solar_plant', 'energy_total_kwh', '2026-10-08 15:00+00', 500);
select test.eq('primeira leitura tem delta zero',
  (select kwh from v_energy_daily
   where device_id = 'solar_plant' and metric = 'energy_total_kwh' and day = '2026-10-08')::numeric, 0);
delete from readings;

-- contador que zera: 100, 105, 3, 6 -> 0 + 5 + 0 + 3
insert into readings (device_id, metric, ts, value) values
  ('appliance_ac', 'energy_total_kwh', '2026-10-08 12:00+00', 100),
  ('appliance_ac', 'energy_total_kwh', '2026-10-08 13:00+00', 105),
  ('appliance_ac', 'energy_total_kwh', '2026-10-08 14:00+00', 3),
  ('appliance_ac', 'energy_total_kwh', '2026-10-08 15:00+00', 6);
select test.eq('contador que zera: soma do dia',
  (select kwh from v_energy_daily
   where device_id = 'appliance_ac' and metric = 'energy_total_kwh' and day = '2026-10-08')::numeric, 8);
select test.eq('contador que zera: nenhum delta negativo',
  (select count(*) from v_energy_deltas where delta_kwh < 0), 0);
delete from readings;

-- virada do dia em Brasilia: 23:55 do dia 7 e 00:00 do dia 8
insert into readings (device_id, metric, ts, value) values
  ('solar_plant', 'energy_total_kwh', '2026-10-08 02:55+00', 10),
  ('solar_plant', 'energy_total_kwh', '2026-10-08 03:00+00', 12);
select test.eq('virada do dia: delta no dia 8',
  (select kwh from v_energy_daily
   where device_id = 'solar_plant' and metric = 'energy_total_kwh' and day = '2026-10-08')::numeric, 2);
select test.eq('virada do dia: dia 7 soma zero',
  (select kwh from v_energy_daily
   where device_id = 'solar_plant' and metric = 'energy_total_kwh' and day = '2026-10-07')::numeric, 0);
delete from readings;

-- series independentes: importado e exportado do mesmo medidor
insert into readings (device_id, metric, ts, value) values
  ('grid_meter', 'energy_import_total_kwh', '2026-10-08 12:00+00', 50),
  ('grid_meter', 'energy_export_total_kwh', '2026-10-08 12:00+00', 200),
  ('grid_meter', 'energy_import_total_kwh', '2026-10-08 13:00+00', 52),
  ('grid_meter', 'energy_export_total_kwh', '2026-10-08 13:00+00', 203);
select test.eq('series independentes: importado',
  (select kwh from v_energy_daily
   where device_id = 'grid_meter' and metric = 'energy_import_total_kwh' and day = '2026-10-08')::numeric, 2);
select test.eq('series independentes: exportado',
  (select kwh from v_energy_daily
   where device_id = 'grid_meter' and metric = 'energy_export_total_kwh' and day = '2026-10-08')::numeric, 3);
delete from readings;

-- potencia media por hora
insert into readings (device_id, metric, ts, value) values
  ('solar_plant', 'power_w', '2026-10-08 15:00+00', 600),
  ('solar_plant', 'power_w', '2026-10-08 15:30+00', 800);
select test.eq('potencia media por hora',
  (select avg_power_w from v_power_hourly
   where device_id = 'solar_plant' and hour_local = '2026-10-08 12:00')::numeric, 700);
select test.eq('energia nao inclui potencia',
  (select count(*) from v_energy_deltas where metric = 'power_w'), 0);
delete from readings;

-- v_now: ultima leitura vence
insert into readings (device_id, metric, ts, value) values
  ('solar_plant', 'power_w', '2026-10-08 15:00+00', 600),
  ('solar_plant', 'power_w', '2026-10-08 15:05+00', 650);
select test.eq('v_now: ultima leitura vence',
  (select value from v_now where device_id = 'solar_plant' and metric = 'power_w')::numeric, 650);
select test.eq('v_now: uma linha por par',
  (select count(*) from v_now where device_id = 'solar_plant' and metric = 'power_w'), 1);
delete from readings;

-- v_now: idade e dado antigo (ts arredondado para baixo ao passo de 5 min)
insert into readings (device_id, metric, ts, value) values
  ('solar_plant', 'power_w',
   date_bin('5 minutes', now() - interval '30 minutes', timestamptz '2000-01-01'), 500),
  ('grid_meter', 'power_w',
   date_bin('5 minutes', now() - interval '5 minutes', timestamptz '2000-01-01'), 300);
select test.ok('v_now: idade de ~30 min',
  (select age_minutes between 29 and 35 from v_now where device_id = 'solar_plant' and metric = 'power_w'));
select test.ok('v_now: 30 min e antiga',
  (select is_stale from v_now where device_id = 'solar_plant' and metric = 'power_w'));
select test.ok('v_now: 5 min nao e antiga',
  (select not is_stale from v_now where device_id = 'grid_meter' and metric = 'power_w'));

-- v_now: limite configuravel
update settings set value = '60' where key = 'stale_after_minutes';
select test.ok('v_now: limite configuravel',
  (select not is_stale from v_now where device_id = 'solar_plant' and metric = 'power_w'));
delete from readings;

rollback;
