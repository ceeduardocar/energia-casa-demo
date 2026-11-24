-- Tabelas base: dispositivos fixos, restrições de readings e settings padrão.
begin;

-- quatro dispositivos
select test.eq('quatro dispositivos', (select count(*) from devices), 4);
select test.ok('ids dos dispositivos',
  (select array_agg(id order by id) from devices)
  = array['appliance_ac', 'appliance_boiler', 'grid_meter', 'solar_plant']);
select test.ok('fonte e tipo dos dispositivos',
  (select bool_and(case id
     when 'solar_plant' then source = 'solarman' and kind = 'solar_plant'
     when 'grid_meter' then source = 'tuya' and kind = 'grid_meter'
     else source = 'tuya' and kind = 'appliance_meter' end)
   from devices));

-- metrica invalida
select test.throws('metrica invalida',
  $$insert into readings (device_id, metric, ts, value)
    values ('solar_plant', 'foo', '2026-10-08 12:05:00+00', 1)$$);

-- potência assinada do medidor geral: negativo exporta, positivo importa
insert into readings (device_id, metric, ts, value)
values ('grid_meter', 'power_signed_w', '2026-10-08 12:05:00+00', -437);
select test.eq('potencia assinada aceita valor negativo',
  (select value from readings where device_id = 'grid_meter' and metric = 'power_signed_w')::numeric, -437);

-- ts fora do passo de 5 min
select test.throws('ts fora do passo de 5 min',
  $$insert into readings (device_id, metric, ts, value)
    values ('solar_plant', 'power_w', '2026-10-08 12:07:00+00', 1)$$);

-- dispositivo inexistente
select test.throws('dispositivo inexistente',
  $$insert into readings (device_id, metric, ts, value)
    values ('x', 'power_w', '2026-10-08 12:05:00+00', 1)$$);

-- idempotencia
insert into readings (device_id, metric, ts, value)
values ('solar_plant', 'power_w', '2026-10-08 12:05:00+00', 500)
on conflict do nothing;
insert into readings (device_id, metric, ts, value)
values ('solar_plant', 'power_w', '2026-10-08 12:05:00+00', 500)
on conflict do nothing;
insert into readings (device_id, metric, ts, value)
values ('solar_plant', 'power_w', '2026-10-08 12:05:00+00', 999)
on conflict do nothing;
select test.eq('idempotencia: uma linha',
  (select count(*) from readings where device_id = 'solar_plant' and metric = 'power_w'), 1);
select test.eq('idempotencia: valor original mantido',
  (select value from readings where device_id = 'solar_plant' and metric = 'power_w')::numeric, 500);

-- settings padrao
select test.ok('settings padrao: stale_after_minutes',
  (select value from settings where key = 'stale_after_minutes') = '15');
select test.ok('settings padrao: solar_low_kwh_per_hour',
  (select value from settings where key = 'solar_low_kwh_per_hour') = '0.2');
select test.ok('settings padrao: credit_trend_days',
  (select value from settings where key = 'credit_trend_days') = '8');

rollback;
