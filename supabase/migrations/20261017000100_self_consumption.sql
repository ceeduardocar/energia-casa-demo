-- Autoconsumo do dia pelo injetado liquido, que e o que a Neoenergia registra.
-- Os contadores brutos do Tuya (v_house_daily.e) contam uma parte a mais nos dois
-- sentidos e deixavam o autoconsumo subestimado. O liquido integra a potencia
-- assinada (v_grid_net_daily), mas nao estima energia em lacunas de coleta; por isso
-- so vale com cobertura do dia >= 95% (ou falta de ate 15 min) e com o dia inteiro
-- depois da primeira leitura de potencia (o dia de instalacao e parcial). Senao usa o
-- bruto, e net_ok = false avisa que o valor e estimado.

create view public.v_self_consumption_daily with (security_invoker = true) as
with first_signed as (
  select min(ts) as ts from public.readings
  where device_id = 'grid_meter' and metric = 'power_signed_w'
), d as (
  select h.day, h.g, h.e as export_gross_kwh, n.export_kwh as export_net_kwh,
    coalesce(n.covered_hours, 0) as covered_hours,
    h.day::timestamp at time zone 'America/Sao_Paulo' >= f.ts as after_start,
    greatest(extract(epoch from
      least(now(), (h.day + 1)::timestamp at time zone 'America/Sao_Paulo')
      - greatest(h.day::timestamp at time zone 'America/Sao_Paulo', f.ts)) / 3600, 0) as expected_hours
  from public.v_house_daily h
  cross join first_signed f
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

revoke all on public.v_self_consumption_daily from anon, authenticated;
grant select on public.v_self_consumption_daily to authenticated;
