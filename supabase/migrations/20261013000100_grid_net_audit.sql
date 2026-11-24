-- Auditoria paralela da rede: integra a potência líquida assinada sem alterar
-- os totais atuais do app e permite comparar marcos manuais da Neoenergia.

create table public.grid_meter_audits (
  id bigint generated always as identity primary key,
  measured_at timestamptz not null unique,
  register_import_kwh double precision not null check (register_import_kwh >= 0),
  register_export_kwh double precision not null check (register_export_kwh >= 0),
  register_24 double precision check (register_24 >= 0),
  note text check (char_length(note) <= 200),
  created_at timestamptz not null default now()
);

alter table public.grid_meter_audits enable row level security;
revoke all on public.grid_meter_audits from anon, authenticated;
grant select, insert, delete on public.grid_meter_audits to authenticated;
grant usage, select on sequence public.grid_meter_audits_id_seq to authenticated;
create policy authenticated_read on public.grid_meter_audits for select to authenticated using (true);
create policy authenticated_insert on public.grid_meter_audits for insert to authenticated with check (true);
create policy authenticated_delete on public.grid_meter_audits for delete to authenticated using (true);

-- Pares com mais de 10 minutos são lacunas, não energia estimada. Quando o
-- sinal cruza zero, as duas áreas triangulares são separadas entre importar/exportar.
create view public.v_grid_net_intervals with (security_invoker = true) as
with pairs as (
  select ts start_ts, value start_w, lead(ts) over (order by ts) end_ts,
         lead(value) over (order by ts) end_w
  from public.readings
  where device_id = 'grid_meter' and metric = 'power_signed_w'
), valid as (
  select *, extract(epoch from end_ts - start_ts) seconds
  from pairs where end_ts > start_ts and end_ts - start_ts <= interval '10 minutes'
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

create view public.v_grid_net_hourly with (security_invoker = true) as
select date_trunc('hour', end_ts at time zone 'America/Sao_Paulo') hour_local,
       sum(import_kwh) import_kwh, sum(export_kwh) export_kwh,
       sum(seconds) / 3600 covered_hours
from public.v_grid_net_intervals group by 1;

create view public.v_grid_net_daily with (security_invoker = true) as
select (end_ts at time zone 'America/Sao_Paulo')::date as day,
       sum(import_kwh) import_kwh, sum(export_kwh) export_kwh,
       sum(seconds) / 3600 covered_hours
from public.v_grid_net_intervals group by 1;

create view public.v_grid_audit_report with (security_invoker = true) as
with marks as (
  select a.*, lag(measured_at) over (order by measured_at) previous_at,
    lag(register_import_kwh) over (order by measured_at) previous_import_kwh,
    lag(register_export_kwh) over (order by measured_at) previous_export_kwh,
    lag(register_24) over (order by measured_at) previous_24
  from public.grid_meter_audits a
), raw as (
  select m.*, ri.value raw_import_kwh, re.value raw_export_kwh,
    pri.value previous_raw_import_kwh, pre.value previous_raw_export_kwh
  from marks m
  left join lateral (select value from public.readings where device_id='grid_meter' and metric='energy_import_total_kwh' and ts<=m.measured_at order by ts desc limit 1) ri on true
  left join lateral (select value from public.readings where device_id='grid_meter' and metric='energy_export_total_kwh' and ts<=m.measured_at order by ts desc limit 1) re on true
  left join lateral (select value from public.readings where device_id='grid_meter' and metric='energy_import_total_kwh' and ts<=m.previous_at order by ts desc limit 1) pri on true
  left join lateral (select value from public.readings where device_id='grid_meter' and metric='energy_export_total_kwh' and ts<=m.previous_at order by ts desc limit 1) pre on true
)
select r.*,
  r.register_import_kwh-r.previous_import_kwh neo_import_kwh,
  r.register_export_kwh-r.previous_export_kwh neo_export_kwh,
  r.register_24-r.previous_24 register_24_delta,
  r.raw_import_kwh-r.previous_raw_import_kwh tuya_import_kwh,
  r.raw_export_kwh-r.previous_raw_export_kwh tuya_export_kwh,
  n.net_import_kwh, n.net_export_kwh, n.coverage
from raw r
left join lateral (
  select
    sum(i.import_kwh * extract(epoch from least(i.end_ts,r.measured_at)-greatest(i.start_ts,r.previous_at))/i.seconds) net_import_kwh,
    sum(i.export_kwh * extract(epoch from least(i.end_ts,r.measured_at)-greatest(i.start_ts,r.previous_at))/i.seconds) net_export_kwh,
    least(sum(extract(epoch from least(i.end_ts,r.measured_at)-greatest(i.start_ts,r.previous_at))) /
      nullif(extract(epoch from r.measured_at-r.previous_at),0),1) coverage
  from public.v_grid_net_intervals i
  where r.previous_at is not null and i.end_ts>r.previous_at and i.start_ts<r.measured_at
) n on true;

revoke all on public.v_grid_net_intervals, public.v_grid_net_hourly,
  public.v_grid_net_daily, public.v_grid_audit_report from anon, authenticated;
grant select on public.v_grid_net_intervals, public.v_grid_net_hourly,
  public.v_grid_net_daily, public.v_grid_audit_report to authenticated;

