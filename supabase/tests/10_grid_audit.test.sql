begin;
-- sessao do usuario autorizado (auth.uid()); ver test.energy_user() no _bootstrap.sql
select set_config('request.jwt.claim.sub', test.energy_user(), true);

insert into readings (device_id, metric, ts, value) values
  ('grid_meter','power_signed_w','2026-10-13 12:00+00',1000),
  ('grid_meter','power_signed_w','2026-10-13 12:05+00',1000),
  ('grid_meter','power_signed_w','2026-10-13 12:10+00',-1000),
  ('grid_meter','power_signed_w','2026-10-13 12:15+00',-1000),
  ('grid_meter','energy_import_total_kwh','2026-10-13 12:00+00',10),
  ('grid_meter','energy_import_total_kwh','2026-10-13 12:15+00',10.2),
  ('grid_meter','energy_export_total_kwh','2026-10-13 12:00+00',20),
  ('grid_meter','energy_export_total_kwh','2026-10-13 12:15+00',20.3);

select test.eq('liquido: importacao com cruzamento',(select sum(import_kwh) from v_grid_net_intervals)::numeric,0.104167,0.000001);
select test.eq('liquido: exportacao com cruzamento',(select sum(export_kwh) from v_grid_net_intervals)::numeric,0.104167,0.000001);

insert into grid_meter_audits (measured_at,register_import_kwh,register_export_kwh,register_24) values
  ('2026-10-13 12:00+00',100,200,1.7),('2026-10-13 12:15+00',100.1,200.1,1.8);
select test.eq('auditoria: delta Neo importado',(select neo_import_kwh from v_grid_audit_report where previous_at is not null)::numeric,0.1);
select test.eq('auditoria: delta Tuya importado',(select tuya_import_kwh from v_grid_audit_report where previous_at is not null)::numeric,0.2);
select test.eq('auditoria: liquido importado',(select net_import_kwh from v_grid_audit_report where previous_at is not null)::numeric,0.104167,0.000001);
select test.eq('auditoria: cobertura completa',(select coverage from v_grid_audit_report where previous_at is not null)::numeric,1);
insert into grid_meter_audits (measured_at,register_import_kwh,register_export_kwh,register_24) values
  ('2026-10-14 12:15+00',101,201,1.9);
select test.eq('auditoria: sem coleta tem cobertura zero',(select coverage from v_grid_audit_report where measured_at='2026-10-14 12:15+00')::numeric,0);

set local role anon;
select test.throws('anon nao le auditorias','select * from grid_meter_audits');
select test.throws('anon nao le relatorio de auditoria','select * from v_grid_audit_report');
reset role;
set local role authenticated;
select test.ok('authenticated le relatorio de auditoria',(select count(*) from v_grid_audit_report)=3);
insert into grid_meter_audits (measured_at,register_import_kwh,register_export_kwh) values ('2026-10-13 12:20+00',101,201);
delete from grid_meter_audits where measured_at='2026-10-13 12:20+00';
select test.ok('authenticated insere e apaga auditoria',(select count(*) from grid_meter_audits where measured_at='2026-10-13 12:20+00')=0);
reset role;

rollback;
