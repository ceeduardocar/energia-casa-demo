-- Energia por hora e por dia a partir dos acumulados (hodômetros).
-- Horas e dias no fuso America/Sao_Paulo.

-- Uma linha por leitura de métrica acumulada (energy_*). A diferença para a
-- leitura anterior da mesma série vai para o horário da leitura mais recente.
-- A primeira leitura de cada série tem delta 0; diferença negativa (contador
-- zerado ou aparelho trocado) conta como 0.
create view public.v_energy_deltas as
select
  device_id,
  metric,
  ts,
  greatest(value - coalesce(lag(value) over w, value), 0) as delta_kwh
from public.readings
where metric like 'energy\_%'
window w as (partition by device_id, metric order by ts);

create view public.v_energy_hourly as
select
  device_id,
  metric,
  date_trunc('hour', ts at time zone 'America/Sao_Paulo') as hour_local,
  sum(delta_kwh) as kwh
from public.v_energy_deltas
group by 1, 2, 3;

create view public.v_energy_daily as
select
  device_id,
  metric,
  (ts at time zone 'America/Sao_Paulo')::date as day,
  sum(delta_kwh) as kwh
from public.v_energy_deltas
group by 1, 2, 3;

create view public.v_power_hourly as
select
  device_id,
  date_trunc('hour', ts at time zone 'America/Sao_Paulo') as hour_local,
  avg(value) as avg_power_w
from public.readings
where metric = 'power_w'
group by 1, 2;

-- Última leitura de cada série, com idade e marca de dado antigo
-- (mais velho que settings.stale_after_minutes).
create view public.v_now as
select
  r.device_id,
  r.metric,
  r.ts,
  r.value,
  (extract(epoch from now() - r.ts) / 60)::double precision as age_minutes,
  extract(epoch from now() - r.ts) / 60
    > (select value::double precision from public.settings where key = 'stale_after_minutes') as is_stale
from (
  select distinct on (device_id, metric) device_id, metric, ts, value
  from public.readings
  order by device_id, metric, ts desc
) r;
