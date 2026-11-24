-- Contas de luz da Neoenergia (spec, seção 5.1) e comparação com o medidor da casa.
-- Só os campos impressos na conta que a spec permite guardar: nada de CPF, nome,
-- endereço, unidade consumidora, código de barras ou QR code.

create table public.bills (
  id                  bigint generated always as identity primary key,
  -- identificação
  access_key          text unique,            -- chave de acesso da nota (44 dígitos); nula se digitada sem ela
  ref_month           date not null check (extract(day from ref_month) = 1),
  issue_date          date,
  due_date            date,
  meter_number        text,
  class               text,                   -- ex.: B1 RESIDENCIAL
  supply_type         text,                   -- ex.: Trifásico
  -- período
  reading_prev_date   date not null,
  reading_curr_date   date not null,
  next_reading_date   date,
  days                int,
  -- medição (kWh), como impresso
  meter_reading_prev  double precision,
  meter_reading_curr  double precision,
  meter_constant      double precision default 1,
  kwh_measured        double precision,       -- (atual − anterior) × constante
  kwh_billed          double precision,       -- "Energia Ativa" faturada
  kwh_reactive        double precision,       -- "Energia Reativa", só informativa
  kwh_adjust_cat      double precision,       -- ajuste CAT (negativo)
  kwh_injected        double precision,       -- energia injetada no mês
  credit_balance_kwh  double precision,       -- saldo para o próximo ciclo
  -- valores (R$)
  tusd_brl            numeric(12, 2),
  te_brl              numeric(12, 2),
  flag_name           text,                   -- bandeira tarifária
  flag_brl            numeric(12, 2),
  interest_brl        numeric(12, 2),
  fine_brl            numeric(12, 2),
  public_lighting_brl numeric(12, 2),
  other_brl           numeric(12, 2),         -- demais itens somados (ex.: crédito ITAIPU, negativo)
  total_brl           numeric(12, 2),
  -- histórico impresso na conta: [{"ref_month": "2026-08", "kwh": 100, "days": 30}, ...]
  consumption_history jsonb not null default '[]',
  -- controle
  file_path           text,
  extraction_method   text check (extraction_method in ('pdf_text', 'vision', 'manual')),
  confirmed_at        timestamptz not null default now(),
  check (reading_prev_date < reading_curr_date),
  check (next_reading_date is null or reading_curr_date < next_reading_date)
);

alter table public.credit_baseline
  add constraint credit_baseline_bill_id_fkey foreign key (bill_id) references public.bills (id);

insert into public.settings (key, value) values ('bill_diff_alert_pct', '5')
on conflict (key) do nothing;

-- Cada conta comparada com o medidor da casa no mesmo período. O período da
-- distribuidora vai do dia seguinte à leitura anterior até o dia da leitura
-- atual (dias locais). Cobertura = leituras de importado gravadas ÷ esperadas
-- (uma a cada 5 min). Abaixo de 99% o status é 'sem_cobertura' (por exemplo,
-- ciclos anteriores ao coletor). Acima do limite de settings, 'atencao'.
-- Importado da conta = kwh_measured; exportado da conta = kwh_injected.
create view public.v_bill_check with (security_invoker = true) as
with b as (
  select
    id, ref_month, reading_prev_date, reading_curr_date, days,
    kwh_measured, kwh_injected,
    ((reading_prev_date + 1)::timestamp at time zone 'America/Sao_Paulo') as from_ts,
    ((reading_curr_date + 1)::timestamp at time zone 'America/Sao_Paulo') as to_ts,
    (reading_curr_date - reading_prev_date) * 288 as expected
  from public.bills
), c as (
  select
    b.*,
    (select count(*) from public.readings r
     where r.device_id = 'grid_meter' and r.metric = 'energy_import_total_kwh'
       and r.ts >= b.from_ts and r.ts < b.to_ts) as got,
    (select sum(d.kwh) from public.v_energy_daily d
     where d.device_id = 'grid_meter' and d.metric = 'energy_import_total_kwh'
       and d.day > b.reading_prev_date and d.day <= b.reading_curr_date) as house_import_kwh,
    (select sum(d.kwh) from public.v_energy_daily d
     where d.device_id = 'grid_meter' and d.metric = 'energy_export_total_kwh'
       and d.day > b.reading_prev_date and d.day <= b.reading_curr_date) as house_export_kwh
  from b
), p as (
  select
    c.*,
    least(c.got::double precision / nullif(c.expected, 0), 1) as coverage,
    greatest(
      abs(c.house_import_kwh - c.kwh_measured) / nullif(c.kwh_measured, 0),
      abs(c.house_export_kwh - c.kwh_injected) / nullif(c.kwh_injected, 0)
    ) * 100 as max_diff_pct
  from c
)
select
  id as bill_id,
  ref_month,
  reading_prev_date,
  reading_curr_date,
  days,
  coverage,
  house_import_kwh,
  kwh_measured as bill_import_kwh,
  house_export_kwh,
  kwh_injected as bill_export_kwh,
  case
    when coalesce(coverage, 0) < 0.99 then 'sem_cobertura'
    when max_diff_pct > (select value::double precision from public.settings
                         where key = 'bill_diff_alert_pct') then 'atencao'
    else 'ok'
  end as status
from p;

-- Segurança: o app lê e insere contas (só depois da confirmação do usuário).
-- Não altera nem apaga. anon sem acesso.
alter table public.bills enable row level security;
revoke all on public.bills, public.v_bill_check from anon, authenticated;
grant select, insert on public.bills to authenticated;
grant select on public.v_bill_check to authenticated;
create policy authenticated_read on public.bills
  for select to authenticated using (true);
create policy authenticated_insert on public.bills
  for insert to authenticated with check (true);
