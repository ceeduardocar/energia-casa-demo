-- v_self_consumption_daily compara o injetado líquido com o injetado BRUTO do Tuya.
-- Desde 20261020000100, v_house_daily.e já usa a potência assinada onde ela existe;
-- para o "bruto" continuar sendo o contador do Tuya (fallback quando a cobertura do
-- dia é baixa), ele passa a vir direto de v_energy_daily, com a mesma regra de antes:
-- contador que já começou e não mudou no dia vale zero, antes da primeira leitura é nulo.
-- O resto da view não muda.

create or replace view public.v_self_consumption_daily with (security_invoker = true) as
with first_signed as (
  select min(ts) as ts from public.readings
  where device_id = 'grid_meter' and metric = 'power_signed_w'
), first_export as (
  select min(ts) as ts from public.readings
  where device_id = 'grid_meter' and metric = 'energy_export_total_kwh'
), gross as (
  select day, sum(kwh) as kwh
  from public.v_energy_daily
  where device_id = 'grid_meter' and metric = 'energy_export_total_kwh'
  group by day
), d as (
  select h.day, h.g,
    case when x.kwh is not null then x.kwh
         when fe.ts < (h.day + 1)::timestamp at time zone 'America/Sao_Paulo' then 0 end as export_gross_kwh,
    n.export_kwh as export_net_kwh,
    coalesce(n.covered_hours, 0) as covered_hours,
    h.day::timestamp at time zone 'America/Sao_Paulo' >= f.ts as after_start,
    greatest(extract(epoch from
      least(now(), (h.day + 1)::timestamp at time zone 'America/Sao_Paulo')
      - greatest(h.day::timestamp at time zone 'America/Sao_Paulo', f.ts)) / 3600, 0) as expected_hours
  from public.v_house_daily h
  cross join first_signed f
  cross join first_export fe
  left join gross x on x.day = h.day
  left join public.v_grid_net_daily n on n.day = h.day
), c as (
  select d.*, least(covered_hours / nullif(expected_hours, 0), 1) as coverage from d
), u as (
  select c.*, coalesce(coverage >= 0.95 or expected_hours - covered_hours <= 0.25, false) and after_start and export_net_kwh is not null as net_ok
  from c
), v as (
  select u.*, case when net_ok then export_net_kwh else export_gross_kwh end as injected_kwh from u
)
select day, g as generation_kwh, injected_kwh, export_net_kwh, export_gross_kwh,
  covered_hours, expected_hours, coverage, net_ok,
  case when g is not null and injected_kwh is not null then greatest(g - injected_kwh, 0) end as self_kwh,
  case when g > 0 and injected_kwh is not null then greatest(g - injected_kwh, 0) / g end as self_pct
from v;
