-- Saldo de créditos, boiler fora do sol e status do coletor.
begin;

-- Grava o medidor da rede uma vez por dia às 12:00 locais: a primeira leitura
-- (no dia start_day) é a âncora com delta 0; os n dias seguintes recebem
-- imp kWh importados e exp kWh exportados cada.
create function pg_temp.grid_days(start_day date, n int, imp double precision, exp double precision)
returns void language sql as $$
  insert into readings (device_id, metric, ts, value)
  select 'grid_meter', m.metric,
         ((start_day + k) + time '12:00') at time zone 'America/Sao_Paulo',
         1000 + k * m.step
  from generate_series(0, n) k,
       (values ('energy_import_total_kwh', imp), ('energy_export_total_kwh', exp)) m(metric, step);
$$;

-- sem baseline
select test.eq('sem baseline', (select count(*) from v_credits), 0);

-- saldo do exemplo: 217 + 86 − max(175 − 100, 0) = 228 (os 100 kWh do mínimo faturado não saem dos créditos)
insert into credit_baseline (as_of, balance_kwh) values ('2026-09-30', 217);
select pg_temp.grid_days('2026-09-30', 1, 175, 86);
select test.eq('saldo do exemplo: base', (select base_kwh from v_credits)::numeric, 217);
select test.eq('saldo do exemplo: exportado', (select exported_kwh from v_credits)::numeric, 86);
select test.eq('saldo do exemplo: importado', (select imported_kwh from v_credits)::numeric, 175);
select test.eq('saldo do exemplo: compensado', (select compensated_kwh from v_credits)::numeric, 75);
select test.eq('saldo do exemplo: saldo', (select balance_kwh from v_credits)::numeric, 228);
select test.eq('minimo faturado', (select min_billed_kwh from v_credits)::numeric, 100);
delete from readings; delete from credit_baseline;

-- baseline mais recente vence, e a energia do próprio dia do baseline não conta
insert into credit_baseline (as_of, balance_kwh) values ('2026-09-20', 500), ('2026-09-30', 217);
insert into readings (device_id, metric, ts, value) values
  ('grid_meter', 'energy_import_total_kwh', '2026-09-24 15:00+00', 1000),
  ('grid_meter', 'energy_import_total_kwh', '2026-09-25 15:00+00', 1050),  -- +50 antes do baseline
  ('grid_meter', 'energy_import_total_kwh', '2026-09-30 15:00+00', 1080),  -- +30 no dia do baseline
  ('grid_meter', 'energy_import_total_kwh', '2026-10-01 15:00+00', 1255),  -- +175
  ('grid_meter', 'energy_export_total_kwh', '2026-09-24 15:00+00', 2000),
  ('grid_meter', 'energy_export_total_kwh', '2026-09-30 15:00+00', 2010),  -- +10 no dia do baseline
  ('grid_meter', 'energy_export_total_kwh', '2026-10-01 15:00+00', 2096);  -- +86
select test.ok('baseline mais recente vence',
  (select as_of = '2026-09-30' and base_kwh = 217 from v_credits));
select test.eq('energia do proprio dia do baseline nao conta: importado',
  (select imported_kwh from v_credits)::numeric, 175);
select test.eq('energia do proprio dia do baseline nao conta: exportado',
  (select exported_kwh from v_credits)::numeric, 86);
select test.eq('baseline mais recente vence: saldo', (select balance_kwh from v_credits)::numeric, 228);
delete from readings; delete from credit_baseline;

-- duracao quando o saldo cai: 8 dias importando 15 e exportando 5; saldo 208 + 40 − (120 − 100) = 228.
-- Dreno em regime (ciclo de 30 dias sem contas): (15 × 30 − 100) / 30 − 5 = 20/3 kWh/dia.
insert into credit_baseline (as_of, balance_kwh) values ('2026-09-30', 208);
select pg_temp.grid_days('2026-09-30', 8, 15, 5);
select test.eq('duracao: saldo', (select balance_kwh from v_credits)::numeric, 228);
select test.eq('duracao: dreno medio', (select avg_net_drain_kwh_per_day from v_credits)::numeric, 20 / 3.0);
select test.eq('duracao quando o saldo cai', (select days_left from v_credits)::numeric, 34.2);
delete from readings; delete from credit_baseline;

-- duracao nula quando o saldo sobe
insert into credit_baseline (as_of, balance_kwh) values ('2026-09-30', 100);
select pg_temp.grid_days('2026-09-30', 8, 5, 15);
select test.eq('saldo subindo: compensado zero abaixo do minimo', (select compensated_kwh from v_credits)::numeric, 0);
select test.eq('saldo subindo: saldo', (select balance_kwh from v_credits)::numeric, 220);
select test.is_null('duracao nula quando o saldo sobe', (select days_left from v_credits));
delete from readings; delete from credit_baseline;

-- conta de 09/2026: 2.038,67 kWh em 09/09; no ritmo dela (312 kWh importados e
-- 312 injetados em 33 dias), 29/09 fica em 2038,67 + 189,09 − (189,09 − 100) = 2138,67
insert into credit_baseline (as_of, balance_kwh) values ('2026-09-09', 2038.67);
select pg_temp.grid_days('2026-09-09', 20, 312 / 33.0, 312 / 33.0);
select test.eq('estimativa em 29/09 pela conta de 09/2026',
  (select balance_kwh from v_credits)::numeric, 2138.67, 0.01);
select test.ok('ciclo atual comeca na leitura', (select cycle_start = '2026-09-09' from v_credits));
delete from readings; delete from credit_baseline;

-- dois ciclos pelas datas de leitura: baseline da conta de 08/2026 (1.938,67 em 07/08),
-- leitura seguinte em 09/09 (conta lançada, mas sem baseline). Cada ciclo tem o seu mínimo.
insert into credit_baseline (as_of, balance_kwh) values ('2026-08-07', 1938.67);
insert into bills (access_key, ref_month, reading_prev_date, reading_curr_date, days)
values ('K-CICLO', '2026-09-01', '2026-08-07', '2026-09-09', 33);
select pg_temp.grid_days('2026-08-07', 53, 312 / 33.0, 312 / 33.0);
select test.eq('dois ciclos: compensado (212 + 89,09)',
  (select compensated_kwh from v_credits)::numeric, 212 + 20 * 312 / 33.0 - 100, 0.01);
select test.eq('dois ciclos: saldo igual ao do ciclo unico',
  (select balance_kwh from v_credits)::numeric, 2138.67, 0.01);
select test.ok('dois ciclos: ciclo atual', (select cycle_start = '2026-09-09' from v_credits));
delete from readings; delete from credit_baseline; delete from bills;

-- conta atrasada: sem leitura nova, o corte é projetado a cada 30 dias.
-- 40 dias importando 10: ciclo 1 compensa 300 − 100; os 10 dias do ciclo 2 (100 kWh) ficam no mínimo.
insert into credit_baseline (as_of, balance_kwh) values ('2026-09-09', 1000);
select pg_temp.grid_days('2026-09-09', 40, 10, 0);
select test.eq('corte projetado: saldo', (select balance_kwh from v_credits)::numeric, 800);
select test.ok('corte projetado: ciclo atual',
  (select cycle_start = '2026-10-09' and cycle_imported_kwh = 100 from v_credits));
delete from readings; delete from credit_baseline;

-- boiler fora do sol: 1,4 kWh numa hora sem geração e 1,0 kWh numa hora com 1,5 kWh
insert into readings (device_id, metric, ts, value) values
  ('solar_plant',      'energy_total_kwh', '2026-10-08 09:00+00', 100),   -- 06:00 local, âncora
  ('appliance_boiler', 'energy_total_kwh', '2026-10-08 09:00+00', 50),
  ('solar_plant',      'energy_total_kwh', '2026-10-08 10:00+00', 100),   -- 07:00 local, g = 0
  ('appliance_boiler', 'energy_total_kwh', '2026-10-08 10:00+00', 51.4),  -- bo = 1,4
  ('solar_plant',      'energy_total_kwh', '2026-10-08 15:00+00', 101.5), -- 12:00 local, g = 1,5
  ('appliance_boiler', 'energy_total_kwh', '2026-10-08 15:00+00', 52.4);  -- bo = 1,0
select test.eq('boiler fora do sol',
  (select boiler_kwh_off_sun from v_boiler_off_sun where day = '2026-10-08')::numeric, 1.4);
select test.eq('boiler total do dia',
  (select boiler_kwh_total from v_boiler_off_sun where day = '2026-10-08')::numeric, 2.4);

-- limite configuravel
update settings set value = '2' where key = 'solar_low_kwh_per_hour';
select test.eq('boiler: limite configuravel',
  (select boiler_kwh_off_sun from v_boiler_off_sun where day = '2026-10-08')::numeric, 2.4);
delete from readings;

-- status do coletor: ultima rodada por fonte
insert into collector_runs (started_at, source, ok, readings_written, error_message) values
  (now() - interval '10 minutes', 'solarman', true, 3, null),
  (now() - interval '5 minutes', 'solarman', false, 0, 'token expirado'),
  (now() - interval '5 minutes', 'tuya', true, 7, null);
select test.ok('ultima rodada por fonte',
  (select ok = false from v_collector_status where source = 'solarman'));
select test.ok('status: idade em minutos',
  (select age_minutes between 4.9 and 5.1 from v_collector_status where source = 'solarman'));
select test.eq('uma linha por fonte', (select count(*) from v_collector_status), 2);
select test.eq('sem mensagem de erro',
  (select count(*) from information_schema.columns
   where table_schema = 'public' and table_name = 'v_collector_status' and column_name = 'error_message'), 0);
delete from collector_runs;

rollback;
