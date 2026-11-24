-- Contas de luz: tabela bills, comparação com o medidor (v_bill_check) e permissões.
begin;
-- sessao do usuario autorizado (auth.uid()); ver test.energy_user() no _bootstrap.sql
select set_config('request.jwt.claim.sub', test.energy_user(), true);

-- Uma conta mínima válida; os testes mudam só o que importa.
create function pg_temp.bill(
  key text, prev date, curr date, measured double precision, injected double precision)
returns bigint language sql as $$
  insert into bills (access_key, ref_month, reading_prev_date, reading_curr_date, days,
                     kwh_measured, kwh_injected, kwh_billed, credit_balance_kwh, total_brl, extraction_method)
  values (key, date_trunc('month', curr)::date, prev, curr, curr - prev,
          measured, injected, 100, 2038.67, 135.40, 'pdf_text')
  returning id;
$$;

-- Grava o medidor da rede a cada 5 min nos dias locais (from_day, to_day], mais uma
-- âncora às 23:55 de from_day (cujo delta fica fora do período). Cada passo soma
-- imp_step importado e exp_step exportado.
create function pg_temp.grid_period(from_day date, to_day date, imp_step double precision, exp_step double precision)
returns void language sql as $$
  insert into readings (device_id, metric, ts, value)
  select 'grid_meter', m.metric, s.ts, 1000 + s.k * m.step
  from (
    select ts, row_number() over (order by ts) - 1 as k
    from generate_series(
      (from_day + time '23:55') at time zone 'America/Sao_Paulo',
      (to_day + time '23:55') at time zone 'America/Sao_Paulo',
      interval '5 minutes') ts
  ) s,
  (values ('energy_import_total_kwh', imp_step), ('energy_export_total_kwh', exp_step)) m(metric, step);
$$;

-- restricoes
select pg_temp.bill('K1', '2026-08-07', '2026-09-09', 312, 312);
select test.throws('chave de acesso repetida',
  $$select pg_temp.bill('K1', '2026-08-07', '2026-09-09', 312, 312)$$);
select test.throws('ref_month fora do dia 1',
  $$insert into bills (access_key, ref_month, reading_prev_date, reading_curr_date)
    values ('K2', '2026-09-15', '2026-08-07', '2026-09-09')$$);
select test.throws('leituras fora de ordem',
  $$insert into bills (access_key, ref_month, reading_prev_date, reading_curr_date)
    values ('K3', '2026-09-01', '2026-09-09', '2026-08-07')$$);
select test.throws('metodo de extracao invalido',
  $$insert into bills (access_key, ref_month, reading_prev_date, reading_curr_date, extraction_method)
    values ('K4', '2026-09-01', '2026-08-07', '2026-09-09', 'ocr')$$);
insert into bills (access_key, ref_month, reading_prev_date, reading_curr_date)
values (null, '2026-07-01', '2026-06-08', '2026-07-08');
insert into bills (access_key, ref_month, reading_prev_date, reading_curr_date)
values (null, '2026-06-01', '2026-05-09', '2026-06-08');
select test.eq('contas digitadas sem chave convivem',
  (select count(*) from bills where access_key is null), 2);
select test.ok('historico padrao vazio',
  (select consumption_history = '[]'::jsonb from bills where access_key = 'K1'));
insert into credit_baseline (as_of, balance_kwh, source, bill_id)
select '2026-09-09', 2038.67, 'bill', id from bills where access_key = 'K1';
select test.ok('baseline aceita conta de origem',
  (select bill_id is not null from credit_baseline where as_of = '2026-09-09'));
select test.throws('baseline com conta inexistente',
  $$insert into credit_baseline (as_of, balance_kwh, source, bill_id) values ('2026-09-10', 1, 'bill', -1)$$);
select test.ok('limite de diferenca padrao',
  (select value from settings where key = 'bill_diff_alert_pct') = '5');
delete from credit_baseline; delete from bills;

-- sem leituras: sem cobertura e somas nulas
select pg_temp.bill('S0', '2026-10-07', '2026-10-09', 10, 5);
select test.ok('sem leituras: sem_cobertura',
  (select status = 'sem_cobertura' and coverage = 0 from v_bill_check));
select test.is_null('sem leituras: importado da casa nulo', (select house_import_kwh from v_bill_check));
delete from bills;

-- cobertura completa: 2 dias (8 e 9) com 288 leituras cada; 0,05 e 0,02 kWh por passo
select pg_temp.grid_period('2026-10-07', '2026-10-09', 0.05, 0.02);
select pg_temp.bill('OK', '2026-10-07', '2026-10-09', 28.8 * 1.02, 11.52 * 0.99);
select test.eq('cobertura completa', (select coverage from v_bill_check)::numeric, 1);
select test.eq('importado da casa', (select house_import_kwh from v_bill_check)::numeric, 28.8);
select test.eq('exportado da casa', (select house_export_kwh from v_bill_check)::numeric, 11.52);
select test.eq('importado da conta = medido', (select bill_import_kwh from v_bill_check)::numeric, 29.376);
select test.eq('exportado da conta = injetado', (select bill_export_kwh from v_bill_check)::numeric, 11.4048);
select test.ok('diferenca pequena: ok', (select status = 'ok' from v_bill_check));
select test.ok('colunas que o app usa',
  (select ref_month = '2026-10-01' and days = 2 and reading_prev_date = '2026-10-07'
          and reading_curr_date = '2026-10-09' from v_bill_check));
delete from bills;

-- diferenca acima do limite: atencao (e o limite vem de settings)
select pg_temp.bill('AT', '2026-10-07', '2026-10-09', 20, 11.52);
select test.ok('diferenca grande: atencao', (select status = 'atencao' from v_bill_check));
update settings set value = '50' where key = 'bill_diff_alert_pct';
select test.ok('limite configuravel', (select status = 'ok' from v_bill_check));
update settings set value = '5' where key = 'bill_diff_alert_pct';
delete from bills;

-- cobertura parcial: falta meio dia de leituras
delete from readings
where ts >= ('2026-10-09'::date + time '12:00') at time zone 'America/Sao_Paulo';
select pg_temp.bill('PC', '2026-10-07', '2026-10-09', 28.8, 11.52);
select test.ok('cobertura parcial: sem_cobertura',
  (select status = 'sem_cobertura' and coverage between 0.7 and 0.8 from v_bill_check));
delete from bills; delete from readings;

-- permissoes
select pg_temp.bill('P1', '2026-08-07', '2026-09-09', 312, 312);
set local role authenticated;
select test.eq('authenticated le bills', (select count(*) from bills), 1);
select test.ok('authenticated le v_bill_check', (select count(*) from v_bill_check) = 1);
insert into bills (access_key, ref_month, reading_prev_date, reading_curr_date, kwh_billed,
                   credit_balance_kwh, consumption_history, extraction_method, confirmed_at)
values ('P2', '2026-10-01', '2026-09-09', '2026-10-07', 100, 2100,
        '[{"ref_month": "2026-09", "kwh": 100, "days": 33}]', 'manual', now());
select test.eq('authenticated insere bills', (select count(*) from bills), 2);
insert into credit_baseline (as_of, balance_kwh, source, bill_id)
select '2026-10-07', 2100, 'bill', id from bills where access_key = 'P2'
on conflict (as_of) do update set balance_kwh = excluded.balance_kwh, source = excluded.source, bill_id = excluded.bill_id;
select test.ok('authenticated grava baseline da conta',
  (select source = 'bill' and bill_id is not null from credit_baseline where as_of = '2026-10-07'));
select test.throws('authenticated nao altera bills', $$update bills set total_brl = 0$$);
select test.throws('authenticated nao apaga bills', $$delete from bills$$);
reset role;
set local role anon;
select test.throws('anon nao le bills', 'select * from bills');
select test.throws('anon nao le v_bill_check', 'select * from v_bill_check');
reset role;

rollback;
