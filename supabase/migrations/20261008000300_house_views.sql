-- A casa por hora e por dia (spec, seção 5).
-- g = geração, i = importado, e = exportado, ac = ar-condicionado, bo = boiler.
-- Uma fonte sem leituras no período fica nula (não zero), e o que depende dela também.

create view public.v_house_hourly as
with p as (
  select
    hour_local,
    sum(kwh) filter (where device_id = 'solar_plant'      and metric = 'energy_total_kwh')        as g,
    sum(kwh) filter (where device_id = 'grid_meter'       and metric = 'energy_import_total_kwh') as i,
    sum(kwh) filter (where device_id = 'grid_meter'       and metric = 'energy_export_total_kwh') as e,
    sum(kwh) filter (where device_id = 'appliance_ac'     and metric = 'energy_total_kwh')        as ac,
    sum(kwh) filter (where device_id = 'appliance_boiler' and metric = 'energy_total_kwh')        as bo
  from public.v_energy_hourly
  group by hour_local
), c as (
  select p.*, g + i - e as consumo from p
)
select
  hour_local, g, i, e, ac, bo, consumo,
  case when consumo is not null
       then greatest(consumo - coalesce(ac, 0) - coalesce(bo, 0), 0) end as outros
from c;

create view public.v_house_daily as
with p as (
  select
    day,
    sum(kwh) filter (where device_id = 'solar_plant'      and metric = 'energy_total_kwh')        as g,
    sum(kwh) filter (where device_id = 'grid_meter'       and metric = 'energy_import_total_kwh') as i,
    sum(kwh) filter (where device_id = 'grid_meter'       and metric = 'energy_export_total_kwh') as e,
    sum(kwh) filter (where device_id = 'appliance_ac'     and metric = 'energy_total_kwh')        as ac,
    sum(kwh) filter (where device_id = 'appliance_boiler' and metric = 'energy_total_kwh')        as bo
  from public.v_energy_daily
  group by day
), c as (
  select
    p.*,
    g + i - e as consumo,
    case when g is not null and e is not null then greatest(g - e, 0) end as autoconsumo
  from p
)
select
  day, g, i, e, ac, bo, consumo, autoconsumo,
  case when consumo is null then null
       when consumo > 0 then least(autoconsumo / consumo, 1)
       else 0 end as autossuficiencia,
  case when consumo is not null
       then greatest(consumo - coalesce(ac, 0) - coalesce(bo, 0), 0) end as outros
from c;

-- Saldo estimado de créditos a partir do baseline mais recente (manual ou da
-- conta de luz). Só conta a energia dos dias DEPOIS de as_of. Sem baseline,
-- a view fica vazia. A duração estimada só existe quando o saldo está caindo
-- (média de importado − exportado dos últimos credit_trend_days dias com dados).
create view public.v_credits as
with b as (
  select as_of, balance_kwh
  from public.credit_baseline
  order by as_of desc
  limit 1
), flow as (
  select
    coalesce(sum(d.kwh) filter (where d.metric = 'energy_export_total_kwh'), 0) as exported_kwh,
    coalesce(sum(d.kwh) filter (where d.metric = 'energy_import_total_kwh'), 0) as imported_kwh
  from b
  join public.v_energy_daily d on d.device_id = 'grid_meter' and d.day > b.as_of
), trend as (
  select avg(coalesce(i, 0) - coalesce(e, 0)) as avg_net_drain
  from (
    select i, e
    from public.v_house_daily
    where i is not null or e is not null
    order by day desc
    limit (select value::int from public.settings where key = 'credit_trend_days')
  ) last_days
)
select
  b.as_of,
  b.balance_kwh as base_kwh,
  f.exported_kwh,
  f.imported_kwh,
  b.balance_kwh + f.exported_kwh - f.imported_kwh as balance_kwh,
  t.avg_net_drain as avg_net_drain_kwh_per_day,
  case when t.avg_net_drain > 0
       then (b.balance_kwh + f.exported_kwh - f.imported_kwh) / t.avg_net_drain end as days_left
from b
cross join flow f
cross join trend t;

-- Energia do boiler nas horas de pouca geração solar (abaixo de
-- settings.solar_low_kwh_per_hour), por dia local. Hora sem leitura solar
-- conta como sem geração. Alimenta o aviso da tela Aparelhos.
create view public.v_boiler_off_sun as
select
  hour_local::date as day,
  coalesce(sum(bo) filter (
    where coalesce(g, 0) < (select value::double precision from public.settings
                            where key = 'solar_low_kwh_per_hour')), 0) as boiler_kwh_off_sun,
  sum(bo) as boiler_kwh_total
from public.v_house_hourly
where bo is not null
group by 1;

-- Última rodada do coletor por fonte, SEM error_message. É a única forma de o
-- app ver o estado do coletor. Não usa security_invoker: o app não lê
-- collector_runs, só esta view (permissões na migration de segurança).
create view public.v_collector_status as
select
  source,
  ok,
  started_at,
  (extract(epoch from now() - started_at) / 60)::double precision as age_minutes
from (
  select distinct on (source) source, ok, started_at
  from public.collector_runs
  order by source, started_at desc
) last_run;
