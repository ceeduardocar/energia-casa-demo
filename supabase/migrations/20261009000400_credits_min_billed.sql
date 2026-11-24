-- Créditos por ciclo de leitura, com o mínimo faturado (custo de disponibilidade).
--
-- A Neoenergia fatura no mínimo min_billed_kwh (100 kWh, trifásico) por ciclo, e
-- esse mínimo NÃO sai dos créditos. Só o que passa dele é compensado:
--   compensado  = max(importado − min_billed_kwh, 0)        (por ciclo)
--   saldo_final = saldo_inicial + injetado − compensado
-- A v_credits anterior (base + exportado − importado) subestimava até 100 kWh por ciclo.
--
-- A CONFIRMAR com a próxima conta (leitura por volta de 07/10/2026): a regra foi
-- inferida de duas contas reais, 08/2026 (1936,67 + 212 − (310 − 100) = 1938,67)
-- e 09/2026 (1938,67 + 312 − (312 − 100) = 2038,67). Se a conta de 10/2026 não
-- fechar com ela, rever esta view e o setting min_billed_kwh.

insert into public.settings (key, value) values ('min_billed_kwh', '100')
on conflict (key) do nothing;

-- Ciclos: começam no as_of do baseline mais recente e em cada data de leitura
-- (bills.reading_curr_date) depois dele; a energia de um dia vai para o ciclo
-- (início, próxima leitura]. Depois da última leitura conhecida, se o medidor
-- já passou da data esperada e a conta ainda não chegou, o corte é projetado a
-- cada cycle_days (média dos últimos 6 ciclos das contas, ou 30).
-- Um baseline manual no meio de um ciclo abre um ciclo novo ali (o importado
-- antes dele no mesmo ciclo não é conhecido): prefira o baseline da conta.
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
  select
    d.day,
    coalesce(sum(d.kwh) filter (where d.metric = 'energy_import_total_kwh'), 0) as imp,
    coalesce(sum(d.kwh) filter (where d.metric = 'energy_export_total_kwh'), 0) as exp
  from b
  join public.v_energy_daily d on d.device_id = 'grid_meter' and d.day > b.as_of
  group by d.day
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
