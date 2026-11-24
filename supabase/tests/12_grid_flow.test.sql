-- Rede pela potência assinada: importado/exportado da casa e dos créditos seguem a
-- integração de power_signed_w depois da primeira leitura assinada; antes disso,
-- ou sem amostra na hora, valem os contadores do Tuya (inflados na exportação).
-- Horários em UTC, hora local = UTC − 3 (dia 2026-10-14).
begin;
-- sessao do usuario autorizado (auth.uid()); ver test.energy_user() no _bootstrap.sql
select set_config('request.jwt.claim.sub', test.energy_user(), true);

-- Contadores (inflados): hora 09 (12:00Z) +2 imp / +4 exp, hora 10 (13:30Z) +1 imp / +6 exp,
-- hora 14 (17:00Z) +1 imp. Geração: +5 na hora 10.
insert into readings (device_id, metric, ts, value) values
  ('grid_meter', 'energy_import_total_kwh', '2026-10-14 03:00+00', 1000),
  ('grid_meter', 'energy_import_total_kwh', '2026-10-14 12:00+00', 1002),
  ('grid_meter', 'energy_import_total_kwh', '2026-10-14 13:30+00', 1003),
  ('grid_meter', 'energy_import_total_kwh', '2026-10-14 17:00+00', 1004),
  ('grid_meter', 'energy_export_total_kwh', '2026-10-14 03:00+00', 1000),
  ('grid_meter', 'energy_export_total_kwh', '2026-10-14 12:00+00', 1004),
  ('grid_meter', 'energy_export_total_kwh', '2026-10-14 13:30+00', 1010),
  ('solar_plant', 'energy_total_kwh', '2026-10-14 03:00+00', 100),
  ('solar_plant', 'energy_total_kwh', '2026-10-14 13:30+00', 105);

-- Potência assinada: -1000 W a cada 5 min de 12:10Z a 14:00Z (09:10 a 11:00 locais).
insert into readings (device_id, metric, ts, value)
select 'grid_meter', 'power_signed_w', t, -1000
from generate_series('2026-10-14 12:10+00'::timestamptz, '2026-10-14 14:00+00', interval '5 minutes') t;

-- Antes da primeira hora cheia depois do primeiro sinal (10:00 local): contadores.
select test.eq('antes do sinal: exportacao vem do contador',
  (select e from v_house_hourly where hour_local = '2026-10-14 09:00')::numeric, 4);
select test.eq('antes do sinal: importacao vem do contador',
  (select i from v_house_hourly where hour_local = '2026-10-14 09:00')::numeric, 2);

-- A partir dele: 12 intervalos de 5 min a 1 kW exportando = 1,0 kWh (o contador diz 6).
select test.eq('com sinal: exportacao pela potencia, nao pelo contador',
  (select e from v_house_hourly where hour_local = '2026-10-14 10:00')::numeric, 1.0);
select test.eq('com sinal: importacao zero, nao a do contador',
  (select i from v_house_hourly where hour_local = '2026-10-14 10:00')::numeric, 0);
select test.eq('com sinal: consumo = g + i - e',
  (select consumo from v_house_hourly where hour_local = '2026-10-14 10:00')::numeric, 4.0);
select test.eq('o intervalo que termina em 11:00 conta na hora 11',
  (select e from v_house_hourly where hour_local = '2026-10-14 11:00')::numeric, 1.0 / 12);

-- Hora depois do corte sem nenhuma amostra assinada: contador (melhor que zero).
select test.eq('sem amostra assinada na hora: importacao do contador',
  (select i from v_house_hourly where hour_local = '2026-10-14 14:00')::numeric, 1);

-- Dia: 4 (contador) + 1,0 + 1/12 (sinal) exportados; 2 + 0 + 0 + 1 importados.
select test.eq('dia: exportado', (select e from v_house_daily where day = '2026-10-14')::numeric, 5 + 1.0 / 12);
select test.eq('dia: importado', (select i from v_house_daily where day = '2026-10-14')::numeric, 3);
select test.eq('dia: consumo', (select consumo from v_house_daily where day = '2026-10-14')::numeric, 5 + 3 - (5 + 1.0 / 12));

-- Créditos usam o mesmo importado/exportado diário.
insert into credit_baseline (as_of, balance_kwh) values ('2026-10-13', 100);
select test.eq('creditos: exportado pela potencia',
  (select exported_kwh from v_credits)::numeric, 5 + 1.0 / 12);
select test.eq('creditos: importado pela potencia + contador',
  (select imported_kwh from v_credits)::numeric, 3);
delete from credit_baseline;

-- Lacunas: até 60 min são interpoladas, acima disso ficam de fora.
insert into readings (device_id, metric, ts, value) values
  ('grid_meter', 'power_signed_w', '2026-10-14 20:00+00', -1000),
  ('grid_meter', 'power_signed_w', '2026-10-14 20:40+00', -1000),
  ('grid_meter', 'power_signed_w', '2026-10-14 22:10+00', -1000);
select test.eq('lacuna de 40 min interpolada',
  (select export_kwh from v_grid_flow_intervals where start_ts = '2026-10-14 20:00+00')::numeric, 2.0 / 3);
select test.eq('lacuna de 90 min fica de fora',
  (select count(*) from v_grid_flow_intervals where start_ts = '2026-10-14 20:40+00'), 0);
-- A auditoria da Neo mantém o limite de 10 min.
select test.eq('auditoria: lacuna de 40 min nao entra',
  (select count(*) from v_grid_net_intervals where start_ts = '2026-10-14 20:00+00'), 0);

-- Segurança: só authenticated lê.
set local role anon;
select test.throws('anon nao le v_grid_energy_hourly', 'select * from v_grid_energy_hourly');
select test.throws('anon nao le v_grid_flow_hourly', 'select * from v_grid_flow_hourly');
reset role;
set local role authenticated;
select test.ok('authenticated le v_grid_energy_daily', (select count(*) from v_grid_energy_daily) > 0);
reset role;

rollback;
