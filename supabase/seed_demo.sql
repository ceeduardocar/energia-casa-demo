-- Dados de DEMONSTRAÇÃO do Energia Casa (não é migration).
--
-- ATENÇÃO: apaga TODAS as leituras dos quatro dispositivos e grava 30 dias
-- simulados (de 30 dias atrás até agora, a cada 5 minutos). Use só em projeto
-- de teste. Recusa rodar se o banco já tiver rodadas do coletor.
--
-- Determinístico (a mesma curva todos os dias) e idempotente. Não abre nem
-- fecha transação, para poder rodar dentro dos testes.
--
-- Curvas (hora local):
--   geração: 0 fora de 6h-18h; 2000 W × sen² com pico ao meio-dia (~12 kWh/dia)
--   boiler:  1500 W das 6h às 8h
--   ar:      900 W das 11h às 15h
--   casa:    base constante de 350 W + boiler + ar
--   rede:    power_w em módulo (sem sinal), como o coletor grava; o sentido vem de
--            importado × exportado da hora (v_house_hourly)

do $$
begin
  if exists (select 1 from public.collector_runs) then
    raise exception 'seed_demo: este banco tem rodadas do coletor; o seed apaga leituras e só roda em projeto de teste';
  end if;
end
$$;

delete from public.readings
where device_id in ('solar_plant', 'grid_meter', 'appliance_ac', 'appliance_boiler');

with bounds as (
  select
    (((now() at time zone 'America/Sao_Paulo')::date - 30)::timestamp
       at time zone 'America/Sao_Paulo') as first_ts,
    date_bin('5 minutes', now(), timestamptz '2000-01-01') as last_ts
), t as (
  select
    ts,
    extract(hour from ts at time zone 'America/Sao_Paulo')
      + extract(minute from ts at time zone 'America/Sao_Paulo') / 60.0 as h
  from bounds, generate_series(bounds.first_ts, bounds.last_ts, interval '5 minutes') ts
), p as (
  select
    ts,
    case when h >= 6 and h < 18 then 2000 * power(sin(pi() * (h - 6) / 12), 2) else 0 end::double precision as solar_w,
    case when h >= 6 and h < 8 then 1500 else 0 end::double precision as boiler_w,
    case when h >= 11 and h < 15 then 900 else 0 end::double precision as ac_w,
    350::double precision as base_w
  from t
), q as (
  select ts, solar_w, boiler_w, ac_w, base_w + boiler_w + ac_w - solar_w as grid_w
  from p
), acc as (
  -- energia de cada passo = potência × 5 min; o acumulado só cresce
  select
    ts, solar_w, boiler_w, ac_w, grid_w,
    1000 + sum(solar_w) over w * 5 / 60 / 1000              as solar_kwh,
    5000 + sum(greatest(grid_w, 0)) over w * 5 / 60 / 1000  as import_kwh,
    3000 + sum(greatest(-grid_w, 0)) over w * 5 / 60 / 1000 as export_kwh,
    200 + sum(ac_w) over w * 5 / 60 / 1000                  as ac_kwh,
    300 + sum(boiler_w) over w * 5 / 60 / 1000              as boiler_kwh
  from q
  window w as (order by ts)
)
insert into public.readings (device_id, metric, ts, value)
select v.device_id, v.metric, acc.ts, v.value
from acc
cross join lateral (values
  ('solar_plant',      'power_w',                 acc.solar_w),
  ('solar_plant',      'energy_total_kwh',        acc.solar_kwh),
  ('grid_meter',       'power_w',                 abs(acc.grid_w)),
  ('grid_meter',       'energy_import_total_kwh', acc.import_kwh),
  ('grid_meter',       'energy_export_total_kwh', acc.export_kwh),
  ('appliance_ac',     'power_w',                 acc.ac_w),
  ('appliance_ac',     'energy_total_kwh',        acc.ac_kwh),
  ('appliance_boiler', 'power_w',                 acc.boiler_w),
  ('appliance_boiler', 'energy_total_kwh',        acc.boiler_kwh)
) v(device_id, metric, value)
on conflict do nothing;

-- Baseline de demonstração no primeiro dia simulado, com o saldo da conta de 09/2026.
insert into public.credit_baseline (as_of, balance_kwh, source)
values ((now() at time zone 'America/Sao_Paulo')::date - 30, 2038.67, 'manual')
on conflict (as_of) do update set balance_kwh = excluded.balance_kwh, source = excluded.source;
