-- Autoconsumo pelo injetado liquido, com fallback para o bruto quando a cobertura do dia e baixa.
begin;
-- sessao do usuario autorizado (auth.uid()); ver test.energy_user() no _bootstrap.sql
select set_config('request.jwt.claim.sub', test.energy_user(), true);

create temp table day_case (device_id text, metric text, kwh double precision);

create function pg_temp.load_day(day_utc_start timestamptz) returns void language sql as $$
  insert into readings (device_id, metric, ts, value)
  select device_id, metric, day_utc_start, 1000 from day_case
  union all
  select device_id, metric, day_utc_start + interval '14 hours', 1000 + kwh from day_case;
$$;

-- dia 07/10: potencia so a partir das 12:00 locais (dia de instalacao parcial); geracao 6, bruto 3
insert into day_case values ('solar_plant','energy_total_kwh',6), ('grid_meter','energy_export_total_kwh',3);
select pg_temp.load_day('2026-10-07 03:00+00');
delete from day_case;
-- dia 08/10: geracao 15, injetado bruto 14; liquido 12 (500 W exportando 24 h), cobertura completa
insert into day_case values ('solar_plant','energy_total_kwh',15), ('grid_meter','energy_export_total_kwh',14);
select pg_temp.load_day('2026-10-08 03:00+00');
-- dia 09/10: geracao 10, injetado bruto 8; liquido so cobre 12 h (lacuna)
delete from day_case;
insert into day_case values ('solar_plant','energy_total_kwh',10), ('grid_meter','energy_export_total_kwh',8);
select pg_temp.load_day('2026-10-09 03:00+00');
-- dia 10/10: geracao 5, injetado bruto 4; sem leitura de potencia
delete from day_case;
insert into day_case values ('solar_plant','energy_total_kwh',5), ('grid_meter','energy_export_total_kwh',4);
select pg_temp.load_day('2026-10-10 03:00+00');

insert into readings (device_id, metric, ts, value)
select 'grid_meter', 'power_signed_w', t, -500
from generate_series('2026-10-07 15:00+00'::timestamptz, '2026-10-09 15:00+00', interval '5 minutes') t;

select test.ok('dia de instalacao parcial cai no bruto', not (select net_ok from v_self_consumption_daily where day = '2026-10-07'));
select test.eq('dia de instalacao parcial: autoconsumo em %',
  (select self_pct from v_self_consumption_daily where day = '2026-10-07')::numeric, 0.5);
select test.ok('dia completo usa o liquido', (select net_ok from v_self_consumption_daily where day = '2026-10-08'));
select test.eq('dia completo: injetado liquido',
  (select injected_kwh from v_self_consumption_daily where day = '2026-10-08')::numeric, 12, 0.1);
select test.eq('dia completo: autoconsumo em kWh',
  (select self_kwh from v_self_consumption_daily where day = '2026-10-08')::numeric, 3, 0.1);
select test.eq('dia completo: autoconsumo em %',
  (select self_pct from v_self_consumption_daily where day = '2026-10-08')::numeric, 0.2, 0.01);

select test.ok('lacuna cai no bruto', not (select net_ok from v_self_consumption_daily where day = '2026-10-09'));
select test.eq('lacuna: injetado bruto',
  (select injected_kwh from v_self_consumption_daily where day = '2026-10-09')::numeric, 8);
select test.eq('lacuna: autoconsumo em %',
  (select self_pct from v_self_consumption_daily where day = '2026-10-09')::numeric, 0.2);

select test.ok('sem potencia cai no bruto', not (select net_ok from v_self_consumption_daily where day = '2026-10-10'));
select test.eq('sem potencia: injetado bruto',
  (select injected_kwh from v_self_consumption_daily where day = '2026-10-10')::numeric, 4);

set local role anon;
select test.throws('anon nao le v_self_consumption_daily', 'select * from v_self_consumption_daily');
reset role;
set local role authenticated;
select test.ok('authenticated le v_self_consumption_daily', (select count(*) from v_self_consumption_daily) >= 3);
reset role;

rollback;
