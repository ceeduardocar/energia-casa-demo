-- Sem intervalos automáticos no período, a cobertura da auditoria deve ser 0%,
-- não 100%. PostgreSQL ignora NULL em least(), por isso o coalesce é explícito.
create or replace view public.v_grid_audit_report with (security_invoker = true) as
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
    least(coalesce(sum(extract(epoch from least(i.end_ts,r.measured_at)-greatest(i.start_ts,r.previous_at))),0) /
      nullif(extract(epoch from r.measured_at-r.previous_at),0),1) coverage
  from public.v_grid_net_intervals i
  where r.previous_at is not null and i.end_ts>r.previous_at and i.start_ts<r.measured_at
) n on true;

