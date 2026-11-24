-- Dados de demonstração: 30 dias coerentes, acumulados que só crescem, idempotente.
begin;

\ir ../seed_demo.sql

create temp table today_local as
select (now() at time zone 'America/Sao_Paulo')::date as d;

select test.ok('trinta dias',
  (select count(*) from v_house_daily
   where day < (select d from today_local) and consumo is not null) >= 29);

select test.ok('identidade do consumo',
  (select bool_and(abs(consumo - (g + i - e)) < 0.001) from v_house_daily));

select test.eq('outros nao negativo',
  (select count(*) from v_house_daily where outros < 0), 0);

select test.eq('acumulados monotonicos: deltas',
  (select count(*) from v_energy_deltas where delta_kwh < 0), 0);
select test.eq('acumulados monotonicos: leituras brutas',
  (select count(*) from (
     select value < lag(value) over (partition by device_id, metric order by ts) as drop
     from readings where metric like 'energy\_%') s
   where drop), 0);

select test.ok('boiler de manha',
  (select bool_and(boiler_kwh_off_sun > 0) from v_boiler_off_sun
   where day < (select d from today_local)));

select test.eq('potencia nunca negativa (rede em modulo)',
  (select count(*) from readings where metric = 'power_w' and value < 0), 0);

select test.ok('creditos com baseline de demonstracao',
  (select balance_kwh is not null from v_credits));

create temp table before as
select count(*) as n, sum(value) as total from readings;

\ir ../seed_demo.sql

select test.ok('idempotente',
  (select n = (select count(*) from readings)
          and abs(total - (select sum(value) from readings)) < 0.000001
   from before));

rollback;
