-- Rede pela potência assinada, não pelos contadores acumulados do Tuya.
--
-- Os contadores total_forward_energy / reverse_energy_total do medidor Tuya contam
-- a mais que a Neoenergia: em 15/10 a 20/10 de 2026 o Tuya somou 62,0 kWh importados
-- e 60,9 kWh exportados contra 55 e 46 da Neoenergia, e o saldo (importado - exportado)
-- ficou em +1,1 contra +9. A integração da potência assinada (power_signed_w) bate com
-- a Neoenergia (55,4 e 46,0, corrigidos pela cobertura de amostras).
--
-- Regra: horas a partir da primeira hora cheia DEPOIS da primeira leitura assinada usam a
-- integração da potência; antes disso, ou em horas sem nenhuma amostra assinada, valem os
-- contadores. Lacunas de até 60 min entre amostras são interpoladas (a auditoria da Neo
-- continua com o limite de 10 min, em v_grid_net_*).
-- Cada intervalo vai para a hora do FIM do intervalo, como os deltas dos contadores
-- (geração, aparelhos), para as parcelas da conta consumo = g + i - e ficarem alinhadas.

create view public.v_grid_flow_intervals with (security_invoker = true) as
with pairs as (
  select ts start_ts, value start_w, lead(ts) over (order by ts) end_ts,
         lead(value) over (order by ts) end_w
  from public.readings
  where device_id = 'grid_meter' and metric = 'power_signed_w'
), valid as (
  select *, extract(epoch from end_ts - start_ts) seconds
  from pairs where end_ts > start_ts and end_ts - start_ts <= interval '60 minutes'
)
select start_ts, end_ts, start_w, end_w, seconds,
  case
    when start_w >= 0 and end_w >= 0 then (start_w + end_w) / 2 * seconds / 3600000
    when start_w > 0 and end_w < 0 then start_w / 2 * seconds * (start_w / (start_w - end_w)) / 3600000
    when start_w < 0 and end_w > 0 then end_w / 2 * seconds * (end_w / (end_w - start_w)) / 3600000
    when start_w = 0 and end_w > 0 then end_w / 2 * seconds / 3600000
    else 0
  end import_kwh,
  case
    when start_w <= 0 and end_w <= 0 then -(start_w + end_w) / 2 * seconds / 3600000
    when start_w < 0 and end_w > 0 then -start_w / 2 * seconds * (-start_w / (end_w - start_w)) / 3600000
    when start_w > 0 and end_w < 0 then -end_w / 2 * seconds * (-end_w / (start_w - end_w)) / 3600000
    when start_w = 0 and end_w < 0 then -end_w / 2 * seconds / 3600000
    else 0
  end export_kwh
from valid;

create view public.v_grid_flow_hourly with (security_invoker = true) as
select date_trunc('hour', end_ts at time zone 'America/Sao_Paulo') as hour_local,
       sum(import_kwh) as import_kwh, sum(export_kwh) as export_kwh,
       sum(seconds) / 3600 as covered_hours
from public.v_grid_flow_intervals
group by 1;

-- Rede por hora para o app: potência assinada quando existe, contadores no resto.
create view public.v_grid_energy_hourly with (security_invoker = true) as
with cut as (
  select date_trunc('hour', min(ts) at time zone 'America/Sao_Paulo') + interval '1 hour' as hour_cut
  from public.readings
  where device_id = 'grid_meter' and metric = 'power_signed_w'
), c as (
  select hour_local,
    sum(kwh) filter (where metric = 'energy_import_total_kwh') as i,
    sum(kwh) filter (where metric = 'energy_export_total_kwh') as e
  from public.v_energy_hourly
  where device_id = 'grid_meter'
  group by hour_local
), hrs as (
  select hour_local from c
  union
  select hour_local from public.v_grid_flow_hourly
)
select h.hour_local,
  case when coalesce(f.hour_local >= cut.hour_cut, false) then f.import_kwh else c.i end as i,
  case when coalesce(f.hour_local >= cut.hour_cut, false) then f.export_kwh else c.e end as e,
  coalesce(f.hour_local >= cut.hour_cut, false) as from_signed
from hrs h
cross join cut
left join c on c.hour_local = h.hour_local
left join public.v_grid_flow_hourly f on f.hour_local = h.hour_local;

create view public.v_grid_energy_daily with (security_invoker = true) as
select hour_local::date as day, sum(i) as i, sum(e) as e
from public.v_grid_energy_hourly
group by 1;

revoke all on public.v_grid_flow_intervals, public.v_grid_flow_hourly,
  public.v_grid_energy_hourly, public.v_grid_energy_daily from anon, authenticated;
grant select on public.v_grid_flow_intervals, public.v_grid_flow_hourly,
  public.v_grid_energy_hourly, public.v_grid_energy_daily to authenticated;

-- Casa por hora e por dia: importado e exportado vêm da rede acima; o resto (geração,
-- aparelhos) continua nos contadores, com a mesma regra de "série começou = delta zero".
create or replace view public.v_house_hourly with (security_invoker = true) as
with first_reading as (
  select
    min(ts) filter (where device_id = 'solar_plant' and metric = 'energy_total_kwh') as g,
    min(ts) filter (where device_id = 'grid_meter' and metric = 'energy_import_total_kwh') as i,
    min(ts) filter (where device_id = 'grid_meter' and metric = 'energy_export_total_kwh') as e,
    min(ts) filter (where device_id = 'appliance_ac' and metric = 'energy_total_kwh') as ac,
    min(ts) filter (where device_id = 'appliance_boiler' and metric = 'energy_total_kwh') as bo
  from public.readings
), raw as (
  select
    hour_local,
    sum(kwh) filter (where device_id = 'solar_plant' and metric = 'energy_total_kwh') as g,
    sum(kwh) filter (where device_id = 'appliance_ac' and metric = 'energy_total_kwh') as ac,
    sum(kwh) filter (where device_id = 'appliance_boiler' and metric = 'energy_total_kwh') as bo
  from public.v_energy_hourly
  group by hour_local
), hrs as (
  select hour_local from raw
  union
  select hour_local from public.v_grid_energy_hourly
), p as (
  select
    h.hour_local,
    case when raw.g is not null then raw.g when first_reading.g < (h.hour_local + interval '1 hour') at time zone 'America/Sao_Paulo' then 0 end as g,
    case when grid.i is not null then grid.i when first_reading.i < (h.hour_local + interval '1 hour') at time zone 'America/Sao_Paulo' then 0 end as i,
    case when grid.e is not null then grid.e when first_reading.e < (h.hour_local + interval '1 hour') at time zone 'America/Sao_Paulo' then 0 end as e,
    case when raw.ac is not null then raw.ac when first_reading.ac < (h.hour_local + interval '1 hour') at time zone 'America/Sao_Paulo' then 0 end as ac,
    case when raw.bo is not null then raw.bo when first_reading.bo < (h.hour_local + interval '1 hour') at time zone 'America/Sao_Paulo' then 0 end as bo
  from hrs h
  cross join first_reading
  left join raw on raw.hour_local = h.hour_local
  left join public.v_grid_energy_hourly grid on grid.hour_local = h.hour_local
), c as (
  select p.*,
    case when g is not null and i is not null and e is not null
         then greatest(g + i - e, 0) end as consumo
  from p
)
select
  hour_local, g, i, e, ac, bo, consumo,
  case when consumo is not null
       then greatest(consumo - coalesce(ac, 0) - coalesce(bo, 0), 0) end as outros
from c;

create or replace view public.v_house_daily with (security_invoker = true) as
with first_reading as (
  select
    min(ts) filter (where device_id = 'solar_plant' and metric = 'energy_total_kwh') as g,
    min(ts) filter (where device_id = 'grid_meter' and metric = 'energy_import_total_kwh') as i,
    min(ts) filter (where device_id = 'grid_meter' and metric = 'energy_export_total_kwh') as e,
    min(ts) filter (where device_id = 'appliance_ac' and metric = 'energy_total_kwh') as ac,
    min(ts) filter (where device_id = 'appliance_boiler' and metric = 'energy_total_kwh') as bo
  from public.readings
), raw as (
  select
    day,
    sum(kwh) filter (where device_id = 'solar_plant' and metric = 'energy_total_kwh') as g,
    sum(kwh) filter (where device_id = 'appliance_ac' and metric = 'energy_total_kwh') as ac,
    sum(kwh) filter (where device_id = 'appliance_boiler' and metric = 'energy_total_kwh') as bo
  from public.v_energy_daily
  group by day
), days as (
  select day from raw
  union
  select day from public.v_grid_energy_daily
), p as (
  select
    d.day,
    case when raw.g is not null then raw.g when first_reading.g < (d.day + 1)::timestamp at time zone 'America/Sao_Paulo' then 0 end as g,
    case when grid.i is not null then grid.i when first_reading.i < (d.day + 1)::timestamp at time zone 'America/Sao_Paulo' then 0 end as i,
    case when grid.e is not null then grid.e when first_reading.e < (d.day + 1)::timestamp at time zone 'America/Sao_Paulo' then 0 end as e,
    case when raw.ac is not null then raw.ac when first_reading.ac < (d.day + 1)::timestamp at time zone 'America/Sao_Paulo' then 0 end as ac,
    case when raw.bo is not null then raw.bo when first_reading.bo < (d.day + 1)::timestamp at time zone 'America/Sao_Paulo' then 0 end as bo
  from days d
  cross join first_reading
  left join raw on raw.day = d.day
  left join public.v_grid_energy_daily grid on grid.day = d.day
), c as (
  select
    p.*,
    case when g is not null and i is not null and e is not null
         then greatest(g + i - e, 0) end as consumo,
    case when g is not null and e is not null then greatest(g - e, 0) end as autoconsumo
  from p
)
select
  day, g, i, e, ac, bo, consumo, autoconsumo,
  case when consumo is null then null
       when consumo > 0 then least(greatest(autoconsumo / consumo, 0), 1)
       else 0 end as autossuficiencia,
  case when consumo is not null
       then greatest(consumo - coalesce(ac, 0) - coalesce(bo, 0), 0) end as outros
from c;

-- Créditos: mesmo cálculo por ciclo de 20261009000400, com importado e exportado da rede
-- pela potência assinada (v_grid_energy_daily). A tendência usa v_house_daily, já atualizada.
create or replace view public.v_credits with (security_invoker = true) as
with b as (
  select as_of, balance_kwh
  from public.credit_baseline
  order by as_of desc
  limit 1
), cfg as (
  select
    (select value::double precision from public.settings where key = 'min_billed_kwh') as min_kwh,
    coalesce((select round(avg(days))::int
              from (select days from public.bills where days > 0
                    order by reading_curr_date desc limit 6) last_bills), 30) as cycle_days
), daily as (
  select g.day, coalesce(g.i, 0) as imp, coalesce(g.e, 0) as exp
  from b
  join public.v_grid_energy_daily g on g.day > b.as_of
), known as (
  select as_of as start from b
  union
  select r.reading_curr_date from public.bills r, b where r.reading_curr_date > b.as_of
), starts as (
  select start from known
  union
  select k.last + g * c.cycle_days
  from (select max(start) as last from known) k
  cross join cfg c
  cross join generate_series(1, greatest(((select max(day) from daily) - k.last) / c.cycle_days, 0)) g
), cycles as (
  select start, lead(start) over (order by start) as next_start from starts
), per_cycle as (
  select c.start, sum(d.imp) as imp, sum(d.exp) as exp
  from cycles c
  join daily d on d.day > c.start and (c.next_start is null or d.day <= c.next_start)
  group by c.start
), flow as (
  select
    coalesce(sum(p.exp), 0) as exported_kwh,
    coalesce(sum(p.imp), 0) as imported_kwh,
    coalesce(sum(greatest(p.imp - (select min_kwh from cfg), 0)), 0) as compensated_kwh
  from per_cycle p
), cur as (
  select start as cycle_start, coalesce((select imp from per_cycle p where p.start = s.start), 0) as cycle_imported_kwh
  from starts s
  order by start desc
  limit 1
), trend as (
  -- Dreno médio por dia em regime: o mínimo do ciclo é rateado pelos dias do ciclo.
  select
    greatest(avg(coalesce(i, 0)) * c.cycle_days - c.min_kwh, 0) / c.cycle_days
      - avg(coalesce(e, 0)) as avg_net_drain
  from (
    select i, e
    from public.v_house_daily
    where i is not null or e is not null
    order by day desc
    limit (select value::int from public.settings where key = 'credit_trend_days')
  ) last_days
  cross join cfg c
  group by c.cycle_days, c.min_kwh
)
select
  b.as_of,
  b.balance_kwh as base_kwh,
  f.exported_kwh,
  f.imported_kwh,
  b.balance_kwh + f.exported_kwh - f.compensated_kwh as balance_kwh,
  t.avg_net_drain as avg_net_drain_kwh_per_day,
  case when t.avg_net_drain > 0
       then (b.balance_kwh + f.exported_kwh - f.compensated_kwh) / t.avg_net_drain end as days_left,
  (select min_kwh from cfg) as min_billed_kwh,
  f.compensated_kwh,
  cu.cycle_start,
  cu.cycle_imported_kwh
from b
cross join flow f
cross join cur cu
left join trend t on true;
