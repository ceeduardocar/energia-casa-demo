-- Views rápidas: o app recalculava tudo sobre as ~400 mil leituras a cada consulta
-- (window function sobre toda a história de energia em v_energy_deltas, varredura
-- completa em v_now e nas primeiras leituras). Medido em 2026-10-20: 0,4 a 0,65 s por
-- consulta, 4,9 s com cache frio, e piorando ~5% por dia.
--
-- 1. energy_hourly guarda o kWh por série e hora local (a mesma conta de v_energy_deltas),
--    mantida por gatilho em readings: um insert recalcula só da hora da leitura mais antiga
--    do lote em diante, então o backfill de dias antigos também fica certo. v_energy_hourly
--    e v_energy_daily passam a ler dela; v_energy_deltas continua existindo (testes e
--    conferência).
-- 2. v_now busca a última leitura de cada série pelo índice (pula de série em série).
-- 3. As "primeiras leituras" de v_house_hourly/daily viram min() pelo índice, não varredura.

create table public.energy_hourly (
  device_id  text not null,
  metric     text not null,
  hour_local timestamp not null,
  kwh        double precision not null,
  primary key (device_id, metric, hour_local)
);
create index energy_hourly_hour_idx on public.energy_hourly (hour_local);

alter table public.energy_hourly enable row level security;
revoke all on public.energy_hourly from anon, authenticated;
grant select on public.energy_hourly to authenticated;
create policy authenticated_read on public.energy_hourly for select to authenticated using (true);

-- Recalcula, para cada série tocada pelo comando, da hora cheia da leitura mais antiga
-- do lote até o fim. A leitura anterior à janela entra só para o lag.
create function public.refresh_energy_hourly() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  -- A coleta nunca pode falhar por causa da tabela derivada: em erro, avisa no log do
  -- Postgres e segue (rebuild_energy_hourly() refaz tudo).
  begin
  delete from public.energy_hourly e
  using (
    select device_id, metric, date_trunc('hour', min(ts) at time zone 'America/Sao_Paulo') as from_hour
    from changed_rows
    where metric like 'energy\_%'
    group by device_id, metric
  ) c
  where e.device_id = c.device_id and e.metric = c.metric and e.hour_local >= c.from_hour;

  insert into public.energy_hourly (device_id, metric, hour_local, kwh)
  select w.device_id, w.metric, date_trunc('hour', w.ts at time zone 'America/Sao_Paulo'), sum(w.delta)
  from (
    select r.device_id, r.metric, r.ts, c.from_ts,
           greatest(r.value - coalesce(lag(r.value) over (partition by r.device_id, r.metric order by r.ts), r.value), 0) as delta
    from (
      select device_id, metric,
             date_trunc('hour', min(ts) at time zone 'America/Sao_Paulo') at time zone 'America/Sao_Paulo' as from_ts
      from changed_rows
      where metric like 'energy\_%'
      group by device_id, metric
    ) c
    join public.readings r
      on r.device_id = c.device_id and r.metric = c.metric
     and r.ts >= coalesce((select max(p.ts) from public.readings p
                           where p.device_id = c.device_id and p.metric = c.metric and p.ts < c.from_ts),
                          c.from_ts)
  ) w
  where w.ts >= w.from_ts
  group by w.device_id, w.metric, date_trunc('hour', w.ts at time zone 'America/Sao_Paulo');
  exception when others then
    raise warning 'refresh_energy_hourly falhou: %', sqlerrm;
  end;
  return null;
end;
$$;

-- Refaz energy_hourly do zero com a definição de v_energy_deltas (conferência ou conserto).
create function public.rebuild_energy_hourly() returns void
language sql security definer set search_path = public, pg_temp as $$
  truncate public.energy_hourly;
  insert into public.energy_hourly (device_id, metric, hour_local, kwh)
  select device_id, metric, date_trunc('hour', ts at time zone 'America/Sao_Paulo'), sum(delta_kwh)
  from public.v_energy_deltas
  group by 1, 2, 3;
$$;
revoke all on function public.rebuild_energy_hourly() from public, anon, authenticated;
revoke all on function public.refresh_energy_hourly() from public, anon, authenticated;

create trigger readings_energy_hourly_ins after insert on public.readings
  referencing new table as changed_rows
  for each statement execute function public.refresh_energy_hourly();
create trigger readings_energy_hourly_del after delete on public.readings
  referencing old table as changed_rows
  for each statement execute function public.refresh_energy_hourly();

create function public.truncate_energy_hourly() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  truncate public.energy_hourly;
  return null;
end;
$$;
revoke all on function public.truncate_energy_hourly() from public, anon, authenticated;
create trigger readings_energy_hourly_trunc after truncate on public.readings
  for each statement execute function public.truncate_energy_hourly();

-- Carga inicial com a definição de sempre.
insert into public.energy_hourly (device_id, metric, hour_local, kwh)
select device_id, metric, date_trunc('hour', ts at time zone 'America/Sao_Paulo'), sum(delta_kwh)
from public.v_energy_deltas
group by 1, 2, 3;

create or replace view public.v_energy_hourly with (security_invoker = true) as
select device_id, metric, hour_local, kwh from public.energy_hourly;

create or replace view public.v_energy_daily with (security_invoker = true) as
select device_id, metric, hour_local::date as day, sum(kwh) as kwh
from public.energy_hourly
group by device_id, metric, hour_local::date;

-- Última leitura de cada série: percorre as séries distintas pelo índice (device_id, metric)
-- e pega a mais recente de cada uma, em vez de ordenar as ~400 mil linhas.
create or replace view public.v_now with (security_invoker = true) as
with recursive s as (
  (select device_id, metric from public.readings order by device_id, metric limit 1)
  union all
  select n.device_id, n.metric
  from s
  cross join lateral (
    select r.device_id, r.metric from public.readings r
    where (r.device_id, r.metric) > (s.device_id, s.metric)
    order by r.device_id, r.metric limit 1
  ) n
)
select
  s.device_id,
  s.metric,
  l.ts,
  l.value,
  (extract(epoch from now() - l.ts) / 60)::double precision as age_minutes,
  extract(epoch from now() - l.ts) / 60
    > (select value::double precision from public.settings where key = 'stale_after_minutes') as is_stale
from s
cross join lateral (
  select r.ts, r.value from public.readings r
  where r.device_id = s.device_id and r.metric = s.metric
  order by r.ts desc limit 1
) l;

-- Casa por hora e por dia: igual a 20261020000100, com as primeiras leituras pelo índice.
create or replace view public.v_house_hourly with (security_invoker = true) as
with first_reading as (
  select
    (select min(ts) from public.readings where device_id = 'solar_plant' and metric = 'energy_total_kwh') as g,
    (select min(ts) from public.readings where device_id = 'grid_meter' and metric = 'energy_import_total_kwh') as i,
    (select min(ts) from public.readings where device_id = 'grid_meter' and metric = 'energy_export_total_kwh') as e,
    (select min(ts) from public.readings where device_id = 'appliance_ac' and metric = 'energy_total_kwh') as ac,
    (select min(ts) from public.readings where device_id = 'appliance_boiler' and metric = 'energy_total_kwh') as bo
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
    (select min(ts) from public.readings where device_id = 'solar_plant' and metric = 'energy_total_kwh') as g,
    (select min(ts) from public.readings where device_id = 'grid_meter' and metric = 'energy_import_total_kwh') as i,
    (select min(ts) from public.readings where device_id = 'grid_meter' and metric = 'energy_export_total_kwh') as e,
    (select min(ts) from public.readings where device_id = 'appliance_ac' and metric = 'energy_total_kwh') as ac,
    (select min(ts) from public.readings where device_id = 'appliance_boiler' and metric = 'energy_total_kwh') as bo
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
