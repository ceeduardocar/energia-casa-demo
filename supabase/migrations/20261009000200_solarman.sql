-- Coletor Solarman (plano 2): teto de potência e controle do backfill do histórico.
-- O cursor do backfill (solarman_backfill_cursor/_base/_start/_done) é criado pelo coletor.

insert into public.settings (key, value) values
  ('solar_max_power_w', '6000'),
  ('solarman_backfill_enabled', 'true'),
  ('solarman_backfill_days_per_run', '10')
on conflict (key) do nothing;
