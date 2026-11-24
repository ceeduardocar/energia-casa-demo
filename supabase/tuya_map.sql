-- Mapa Tuya → métricas internas (device_metric_map). Rodar À MÃO no editor SQL do Supabase
-- ou com `supabase db query --linked -f supabase/tuya_map.sql`. Não é migration: os IDs são
-- dos medidores instalados. Idempotente.
--
-- scale = fator que o valor bruto da Tuya multiplica para chegar à unidade interna:
--   power_total do medidor geral: kW com escala 3 → W = bruto × 1
--   power_a/power_b do Smart Meter: W com escala 1 → W = bruto × 0,1
--   energias acumuladas: kW·h com escala 2 → kWh = bruto × 0,01
insert into public.device_metric_map (source, external_id, source_code, device_id, metric, scale) values
  ('tuya', 'demo_grid_meter_0001', 'power_total',          'grid_meter',       'power_w',                 1),
  ('tuya', 'demo_grid_meter_0001', 'total_forward_energy', 'grid_meter',       'energy_import_total_kwh', 0.01),
  ('tuya', 'demo_grid_meter_0001', 'reverse_energy_total', 'grid_meter',       'energy_export_total_kwh', 0.01),
  ('tuya', 'demo_appl_meter_0002', 'power_a',              'appliance_ac',     'power_w',                 0.1),
  ('tuya', 'demo_appl_meter_0002', 'forward_energy_1',     'appliance_ac',     'energy_total_kwh',        0.01),
  ('tuya', 'demo_appl_meter_0002', 'power_b',              'appliance_boiler', 'power_w',                 0.1),
  ('tuya', 'demo_appl_meter_0002', 'forward_energy_2',     'appliance_boiler', 'energy_total_kwh',        0.01)
on conflict (source, external_id, source_code) do nothing;
