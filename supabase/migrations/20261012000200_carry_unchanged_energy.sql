-- Um contador acumulado Tuya só muda o timestamp quando seu valor muda.
-- Depois que a série já começou, a ausência de leitura em uma hora/dia significa
-- delta zero, não dado desconhecido. Antes da primeira leitura continua sendo NULL.

create or replace view public.v_house_hourly as
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
    sum(kwh) filter (where device_id = 'grid_meter' and metric = 'energy_import_total_kwh') as i,
    sum(kwh) filter (where device_id = 'grid_meter' and metric = 'energy_export_total_kwh') as e,
    sum(kwh) filter (where device_id = 'appliance_ac' and metric = 'energy_total_kwh') as ac,
    sum(kwh) filter (where device_id = 'appliance_boiler' and metric = 'energy_total_kwh') as bo
  from public.v_energy_hourly
  group by hour_local
), p as (
  select
    raw.hour_local,
    case when raw.g is not null then raw.g when first_reading.g < (raw.hour_local + interval '1 hour') at time zone 'America/Sao_Paulo' then 0 end as g,
    case when raw.i is not null then raw.i when first_reading.i < (raw.hour_local + interval '1 hour') at time zone 'America/Sao_Paulo' then 0 end as i,
    case when raw.e is not null then raw.e when first_reading.e < (raw.hour_local + interval '1 hour') at time zone 'America/Sao_Paulo' then 0 end as e,
    case when raw.ac is not null then raw.ac when first_reading.ac < (raw.hour_local + interval '1 hour') at time zone 'America/Sao_Paulo' then 0 end as ac,
    case when raw.bo is not null then raw.bo when first_reading.bo < (raw.hour_local + interval '1 hour') at time zone 'America/Sao_Paulo' then 0 end as bo
  from raw cross join first_reading
), c as (
  select p.*, g + i - e as consumo from p
)
select
  hour_local, g, i, e, ac, bo, consumo,
  case when consumo is not null
       then greatest(consumo - coalesce(ac, 0) - coalesce(bo, 0), 0) end as outros
from c;

create or replace view public.v_house_daily as
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
    sum(kwh) filter (where device_id = 'grid_meter' and metric = 'energy_import_total_kwh') as i,
    sum(kwh) filter (where device_id = 'grid_meter' and metric = 'energy_export_total_kwh') as e,
    sum(kwh) filter (where device_id = 'appliance_ac' and metric = 'energy_total_kwh') as ac,
    sum(kwh) filter (where device_id = 'appliance_boiler' and metric = 'energy_total_kwh') as bo
  from public.v_energy_daily
  group by day
), p as (
  select
    raw.day,
    case when raw.g is not null then raw.g when first_reading.g < (raw.day + 1)::timestamp at time zone 'America/Sao_Paulo' then 0 end as g,
    case when raw.i is not null then raw.i when first_reading.i < (raw.day + 1)::timestamp at time zone 'America/Sao_Paulo' then 0 end as i,
    case when raw.e is not null then raw.e when first_reading.e < (raw.day + 1)::timestamp at time zone 'America/Sao_Paulo' then 0 end as e,
    case when raw.ac is not null then raw.ac when first_reading.ac < (raw.day + 1)::timestamp at time zone 'America/Sao_Paulo' then 0 end as ac,
    case when raw.bo is not null then raw.bo when first_reading.bo < (raw.day + 1)::timestamp at time zone 'America/Sao_Paulo' then 0 end as bo
  from raw cross join first_reading
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

alter view public.v_house_hourly set (security_invoker = true);
alter view public.v_house_daily set (security_invoker = true);
